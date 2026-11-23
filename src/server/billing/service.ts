import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/server/supabase/admin";
import { env } from "@/server/env";
import { stripe } from "./stripe";
import { USAGE_PLAN_KEY, billable, billingConfig } from "@/config/billing";
import { monthStart } from "@/server/usage";

async function ensureCustomer(orgId: string, email: string) {
  const admin = createAdminClient();
  const { data: sub } = await admin.from("subscriptions").select("stripe_customer_id").eq("org_id", orgId).single();
  if (sub?.stripe_customer_id) return sub.stripe_customer_id;
  const { data: org } = await admin.from("organizations").select("name, legal_name").eq("id", orgId).single();
  const customer = await stripe().customers.create({ email, name: org?.legal_name ?? org?.name ?? undefined, metadata: { orgId } }, { idempotencyKey: `customer-${orgId}` });
  await admin.from("subscriptions").update({ stripe_customer_id: customer.id }).eq("org_id", orgId);
  return customer.id;
}

export async function createSubscriptionCheckout(orgId: string, email: string, planKey: string) {
  const admin = createAdminClient();
  const { data: plan } = await admin.from("plans").select("key, stripe_price_id, is_active").eq("key", planKey).single();
  if (!plan?.stripe_price_id || !plan.is_active) throw new Error("plan_not_available");
  const customer = await ensureCustomer(orgId, email);
  const usage = plan.key === USAGE_PLAN_KEY;
  const { data: full } = await admin.from("plans").select("price_cents").eq("key", planKey).single();
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    // Usage plan: metered monthly price + the one-time start fee on the first invoice.
    line_items: usage
      ? [{ price: plan.stripe_price_id }, { price_data: { currency: "eur", unit_amount: full?.price_cents ?? billingConfig().setupFeeCents, product_data: { name: "Leadwerk starttarief (eenmalig)" } }, quantity: 1 }]
      : [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url: `${env().APP_URL}/billing?checkout=success`,
    cancel_url: `${env().APP_URL}/billing?checkout=cancelled`,
    client_reference_id: orgId,
    allow_promotion_codes: true,
    automatic_tax: { enabled: false },
    metadata: { orgId, planKey },
    subscription_data: { metadata: { orgId, planKey } },
  });
  return session.url!;
}

export async function createCreditCheckout(orgId: string, email: string, packKey: string) {
  const admin = createAdminClient();
  const { data: pack } = await admin.from("credit_packs").select("*").eq("key", packKey).eq("is_active", true).single();
  if (!pack) throw new Error("pack_not_available");
  const customer = await ensureCustomer(orgId, email);
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: pack.stripe_price_id
      ? [{ price: pack.stripe_price_id, quantity: 1 }]
      : [{ price_data: { currency: "eur", unit_amount: pack.price_cents, product_data: { name: `${pack.quantity} ${pack.kind} credits` } }, quantity: 1 }],
    success_url: `${env().APP_URL}/billing?checkout=success`,
    cancel_url: `${env().APP_URL}/billing?checkout=cancelled`,
    client_reference_id: orgId,
    metadata: { orgId, packKey, kind: pack.kind, quantity: String(pack.quantity) },
  });
  return session.url!;
}

export async function createPortalSession(orgId: string) {
  const admin = createAdminClient();
  const { data: sub } = await admin.from("subscriptions").select("stripe_customer_id").eq("org_id", orgId).single();
  if (!sub?.stripe_customer_id) throw new Error("no_customer");
  const s = await stripe().billingPortal.sessions.create({ customer: sub.stripe_customer_id, return_url: `${env().APP_URL}/billing` });
  return s.url;
}

const STATUS_MAP: Record<string, string> = {
  active: "active", trialing: "trialing", past_due: "past_due", canceled: "canceled", unpaid: "unpaid",
  incomplete: "incomplete", incomplete_expired: "incomplete_expired", paused: "paused",
};

async function applySubscription(sub: Stripe.Subscription) {
  const admin = createAdminClient();
  const orgId = sub.metadata?.orgId;
  const priceId = sub.items.data[0]?.price.id;
  const { data: plan } = priceId ? await admin.from("plans").select("key").eq("stripe_price_id", priceId).maybeSingle() : { data: null };
  const item = sub.items.data[0] as Stripe.SubscriptionItem & { current_period_start?: number; current_period_end?: number };
  const periodStart = item?.current_period_start ?? (sub as unknown as { current_period_start?: number }).current_period_start;
  const periodEnd = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const patch: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    status: STATUS_MAP[sub.status] ?? "incomplete",
    cancel_at_period_end: sub.cancel_at_period_end,
    ...(plan?.key ? { plan_key: plan.key } : {}),
    ...(periodStart ? { current_period_start: new Date(periodStart * 1000).toISOString() } : {}),
    ...(periodEnd ? { current_period_end: new Date(periodEnd * 1000).toISOString() } : {}),
    trial_ends_at: null,
  };
  let q = admin.from("subscriptions").update(patch);
  q = orgId ? q.eq("org_id", orgId) : q.eq("stripe_customer_id", patch.stripe_customer_id as string);
  const { error } = await q;
  if (error) throw new Error(`subscription update failed: ${error.message}`);
}

/** Process a verified Stripe event exactly once. */
export async function handleStripeEvent(event: Stripe.Event) {
  const admin = createAdminClient();
  const { error: dup } = await admin.from("webhook_events").insert({ id: event.id, provider: "stripe", type: event.type });
  if (dup?.code === "23505") return { duplicate: true };
  try {
    return await processEvent(event);
  } catch (err) {
    // Allow Stripe's retry to process the event again.
    await admin.from("webhook_events").delete().eq("provider", "stripe").eq("id", event.id);
    throw err;
  }
}

async function processEvent(event: Stripe.Event) {
  const admin = createAdminClient();
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const orgId = s.metadata?.orgId ?? s.client_reference_id;
      if (!orgId) break;
      if (s.mode === "payment" && s.metadata?.kind && s.payment_status === "paid") {
        const { data: sub } = await admin.from("subscriptions").select("current_period_end").eq("org_id", orgId).single();
        await admin.from("credit_grants").upsert(
          { org_id: orgId, kind: s.metadata.kind, quantity: Number(s.metadata.quantity), reason: "purchase", stripe_checkout_session_id: s.id, expires_at: sub?.current_period_end ?? null },
          { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true },
        );
      }
      if (s.mode === "subscription" && s.subscription) {
        const sub = await (await import("./stripe")).stripe().subscriptions.retrieve(typeof s.subscription === "string" ? s.subscription : s.subscription.id);
        await applySubscription({ ...sub, metadata: { ...sub.metadata, orgId } });
        if (s.metadata?.planKey === USAGE_PLAN_KEY) {
          const now = new Date().toISOString();
          await admin.from("subscriptions").update({ setup_paid_at: now, usage_reported_until: now }).eq("org_id", orgId).is("setup_paid_at", null);
        }
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object as Stripe.Subscription);
      break;
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const customer = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
      if (customer) await admin.from("subscriptions").update({ status: "past_due" }).eq("stripe_customer_id", customer);
      break;
    }
  }
  return { handled: event.type };
}

/** Platform admin: create Stripe products/prices for plans and packs without a price id (or with a changed amount). */
export async function syncPlansToStripe() {
  const admin = createAdminClient();
  const { data: plans } = await admin.from("plans").select("*").eq("is_active", true).gt("price_cents", 0).neq("key", USAGE_PLAN_KEY);
  const results: string[] = [];
  if (await ensureUsagePrice()) results.push(USAGE_PLAN_KEY);
  for (const p of plans ?? []) {
    let needsPrice = !p.stripe_price_id;
    if (p.stripe_price_id) {
      const existing = await stripe().prices.retrieve(p.stripe_price_id).catch(() => null);
      needsPrice = !existing || existing.unit_amount !== p.price_cents || !existing.active;
    }
    if (!needsPrice) continue;
    const product = await stripe().products.create({ name: `Leadwerk ${p.name}`, metadata: { planKey: p.key } });
    const price = await stripe().prices.create({ product: product.id, currency: p.currency, unit_amount: p.price_cents, recurring: { interval: p.interval }, metadata: { planKey: p.key } });
    await admin.from("plans").update({ stripe_price_id: price.id }).eq("key", p.key);
    results.push(p.key);
  }
  return results;
}

/**
 * Usage plan: a Stripe Billing Meter (sum of cents) and a metered monthly
 * price of €0.01 per unit. Returns true when something was created.
 */
export async function ensureUsagePrice() {
  const admin = createAdminClient();
  const { data: plan } = await admin.from("plans").select("stripe_price_id").eq("key", USAGE_PLAN_KEY).maybeSingle();
  if (!plan) return false;
  if (plan.stripe_price_id) {
    const existing = await stripe().prices.retrieve(plan.stripe_price_id).catch(() => null);
    if (existing?.active && existing.recurring?.usage_type === "metered") return false;
  }
  const eventName = billingConfig().meterEventName;
  const meters = await stripe().billing.meters.list({ status: "active", limit: 100 });
  const meter = meters.data.find((m) => m.event_name === eventName) ?? (await stripe().billing.meters.create({
    display_name: "Leadwerk verbruik (cent)",
    event_name: eventName,
    default_aggregation: { formula: "sum" },
    customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
    value_settings: { event_payload_key: "value" },
  }));
  const product = await stripe().products.create({ name: "Leadwerk verbruik", metadata: { planKey: USAGE_PLAN_KEY } });
  const price = await stripe().prices.create({
    product: product.id, currency: "eur", unit_amount: 1,
    recurring: { interval: "month", usage_type: "metered", meter: meter.id },
    metadata: { planKey: USAGE_PLAN_KEY },
  });
  await admin.from("plans").update({ stripe_price_id: price.id }).eq("key", USAGE_PLAN_KEY);
  return true;
}

/**
 * Daily: report each usage-billed workspace's billable usage (provider cost ×
 * (1 + markup)) since the last report to Stripe as meter events. Stripe adds
 * it to the monthly invoice. Idempotent per period via the event identifier.
 */
export async function reportUsageToStripe(now = new Date()) {
  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("subscriptions")
    .select("org_id, stripe_customer_id, usage_reported_until, setup_paid_at, status")
    .eq("plan_key", USAGE_PLAN_KEY)
    .in("status", ["active", "past_due"])
    .not("stripe_customer_id", "is", null);
  const { meterEventName } = billingConfig();
  let reported = 0;
  for (const s of subs ?? []) {
    const from = s.usage_reported_until ?? s.setup_paid_at ?? monthStart(now);
    const to = now.toISOString();
    const { data: cost } = await admin.rpc("usage_cost_cents", { p_org: s.org_id, p_from: from, p_to: to });
    const cents = billable(Number(cost ?? 0));
    if (cents > 0) {
      await stripe().billing.meterEvents.create({
        event_name: meterEventName,
        payload: { stripe_customer_id: s.stripe_customer_id!, value: String(cents) },
        identifier: `${s.org_id}:${to}`,
        timestamp: Math.floor(now.getTime() / 1000),
      });
      reported++;
    }
    await admin.from("subscriptions").update({ usage_reported_until: to }).eq("org_id", s.org_id);
  }
  return { reported };
}

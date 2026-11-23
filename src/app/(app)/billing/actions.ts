"use server";
import { paywallEnabled } from "@/server/usage";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspace, requireRole } from "@/server/auth";
import { createAdminClient } from "@/server/supabase/admin";
import { fail, ok, safeAction, type ActionResult } from "@/server/actions";
import { stripeMode } from "@/server/billing/stripe";
import { createCreditCheckout, createPortalSession, createSubscriptionCheckout, syncPlansToStripe } from "@/server/billing/service";
import { isProduction } from "@/server/env";

export async function choosePlanAction(planKey: unknown): Promise<ActionResult<{ simulated: boolean }>> {
  const ws = await requireRole("owner");
  const key = z.string().regex(/^[a-z0-9_]+$/).parse(planKey);
  if (stripeMode() === "live") {
    const url = await createSubscriptionCheckout(ws.org.id, ws.user.email, key).catch((e: Error) => e.message);
    if (url.startsWith("http")) redirect(url);
    return fail(url);
  }
  if (isProduction()) return fail("not_configured");
  // Without Stripe nobody can activate a paid plan for free; only the operator can (manual activation).
  if (paywallEnabled() && !ws.isPlatformAdmin) return fail("payments_unavailable");
  // Demo mode: simulate the subscription change.
  const admin = createAdminClient();
  const now = new Date();
  await admin.from("subscriptions").update({
    plan_key: key, status: "active", trial_ends_at: null, current_period_start: now.toISOString(), current_period_end: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
    ...(key === "usage" ? { setup_paid_at: now.toISOString(), usage_reported_until: now.toISOString() } : {}),
  }).eq("org_id", ws.org.id);
  revalidatePath("/billing");
  return ok({ simulated: true });
}

export async function buyPackAction(packKey: unknown): Promise<ActionResult<{ simulated: boolean }>> {
  const ws = await requireRole("admin");
  const key = z.string().max(60).parse(packKey);
  if (stripeMode() === "live") {
    const url = await createCreditCheckout(ws.org.id, ws.user.email, key).catch((e: Error) => e.message);
    if (url.startsWith("http")) redirect(url);
    return fail(url);
  }
  if (isProduction()) return fail("not_configured");
  if (paywallEnabled() && !ws.isPlatformAdmin) return fail("payments_unavailable");
  const admin = createAdminClient();
  const { data: pack } = await admin.from("credit_packs").select("kind, quantity").eq("key", key).single();
  const { data: sub } = await admin.from("subscriptions").select("current_period_end").eq("org_id", ws.org.id).single();
  if (pack) await admin.from("credit_grants").insert({ org_id: ws.org.id, kind: pack.kind, quantity: pack.quantity, reason: "demo_purchase", expires_at: sub?.current_period_end ?? null });
  revalidatePath("/billing");
  return ok({ simulated: true });
}

export async function openPortalAction() {
  const ws = await requireRole("owner");
  const url = await createPortalSession(ws.org.id);
  redirect(url);
}

export async function savePlanAction(input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await getWorkspace();
    if (!ws.isPlatformAdmin) return fail("forbidden");
    const p = z.object({
      key: z.string().regex(/^[a-z0-9_]+$/),
      name: z.string().trim().min(1).max(60),
      price_cents: z.number().int().min(0).max(10_000_00),
      limits: z.record(z.enum(["users", "search", "enrichment", "research", "email_generation", "send"]), z.number().int().min(0).max(10_000_000)),
      stripe_price_id: z.string().trim().max(120).nullable(),
      is_public: z.boolean(),
      is_active: z.boolean(),
    }).parse(input);
    const admin = createAdminClient();
    const { error } = await admin.from("plans").update({ name: p.name, price_cents: p.price_cents, limits: p.limits, stripe_price_id: p.stripe_price_id || null, is_public: p.is_public, is_active: p.is_active }).eq("key", p.key);
    if (error) throw error;
    revalidatePath("/billing");
    return ok(null);
  });
}

export async function syncStripeAction(): Promise<ActionResult<{ plans: string[] }>> {
  return safeAction(async () => {
    const ws = await getWorkspace();
    if (!ws.isPlatformAdmin) return fail("forbidden");
    if (stripeMode() !== "live") return fail("not_configured");
    const plans = await syncPlansToStripe();
    revalidatePath("/billing");
    return ok({ plans });
  });
}

/** Owner: set the monthly spending cap (euros; 0 = no cap). */
export async function setSpendCapAction(euros: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("owner");
    const cap = z.number().int().min(0).max(100_000).parse(euros);
    const admin = createAdminClient();
    const { data: sub } = await admin.from("subscriptions").select("limit_overrides").eq("org_id", ws.org.id).single();
    await admin.from("subscriptions").update({ limit_overrides: { ...((sub?.limit_overrides as object) ?? {}), spend_cap_cents: cap * 100 } }).eq("org_id", ws.org.id);
    revalidatePath("/billing");
    return ok(null);
  });
}

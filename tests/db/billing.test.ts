import { beforeAll, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { NextRequest } from "next/server";
import { admin, createOrgFor, createTestUser, type TestUser } from "./helpers";

process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_signature_only";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
process.env.JOBS_DISABLED = "1";

let owner: TestUser;
let outsider: TestUser;
let orgId: string;

beforeAll(async () => {
  owner = await createTestUser("billing");
  outsider = await createTestUser("outsider");
  orgId = await createOrgFor(owner, `Billing Org ${Date.now()}`);
  await createOrgFor(outsider, `Other Org ${Date.now()}`);
  await admin.from("plans").update({ stripe_price_id: "price_test_growth" }).eq("key", "growth");
});

function signedRequest(event: object) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
  return new NextRequest("http://localhost/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": header } });
}

describe("analytics", () => {
  it("returns a summary for members only", async () => {
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = new Date().toISOString();
    const { data, error } = await owner.client.rpc("analytics_summary", { p_org: orgId, p_from: from, p_to: to });
    expect(error).toBeNull();
    expect(data.totals).toMatchObject({ sent: 0, replies: 0 });
    expect(data.daily.length).toBeGreaterThanOrEqual(30);
    const denied = await outsider.client.rpc("analytics_summary", { p_org: orgId, p_from: from, p_to: to });
    expect(denied.error).not.toBeNull();
  });
});

describe("subscriptions & credits", () => {
  it("stops consuming credits when the trial has expired", async () => {
    await admin.from("subscriptions").update({ trial_ends_at: "2020-01-01T00:00:00Z" }).eq("org_id", orgId);
    const { data } = await admin.rpc("consume_credits", { p_org: orgId, p_kind: "search", p_quantity: 1, p_idempotency_key: `t-${Date.now()}` });
    expect(data).toBe(false);
    await admin.from("subscriptions").update({ trial_ends_at: new Date(Date.now() + 86_400_000).toISOString() }).eq("org_id", orgId);
  });

  it("rejects webhooks with an invalid signature", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const req = new NextRequest("http://localhost/api/webhooks/stripe", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=bad" } });
    expect((await POST(req)).status).toBe(400);
  });

  it("grants purchased credits once (idempotent)", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const event = {
      id: `evt_pack_${Date.now()}`, object: "event", type: "checkout.session.completed",
      data: { object: { id: `cs_${Date.now()}`, object: "checkout.session", mode: "payment", payment_status: "paid", client_reference_id: orgId, metadata: { orgId, packKey: "emails_250", kind: "email_generation", quantity: "250" } } },
    };
    expect((await POST(signedRequest(event))).status).toBe(200);
    const again = await POST(signedRequest(event));
    expect(await again.json()).toEqual({ duplicate: true });
    const { data: grants } = await admin.from("credit_grants").select("quantity").eq("org_id", orgId).eq("kind", "email_generation");
    expect(grants).toEqual([{ quantity: 250 }]);
    const { data: status } = await owner.client.rpc("credit_status", { p_org: orgId });
    expect((status as { kind: string; allowance: number }[]).find((s) => s.kind === "email_generation")!.allowance).toBe(25 + 250);
  });

  it("applies subscription updates and payment failures", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const now = Math.floor(Date.now() / 1000);
    const customer = `cus_test_${Date.now()}`;
    const sub = {
      id: `sub_test_${Date.now()}`, object: "subscription", customer, status: "active", cancel_at_period_end: false, metadata: { orgId },
      items: { data: [{ price: { id: "price_test_growth" }, current_period_start: now, current_period_end: now + 30 * 86_400 }] },
    };
    expect((await POST(signedRequest({ id: `evt_sub_${Date.now()}`, object: "event", type: "customer.subscription.updated", data: { object: sub } }))).status).toBe(200);
    const { data: s1 } = await admin.from("subscriptions").select("plan_key, status, stripe_customer_id").eq("org_id", orgId).single();
    expect(s1).toEqual({ plan_key: "growth", status: "active", stripe_customer_id: customer });
    await POST(signedRequest({ id: `evt_inv_${Date.now()}`, object: "event", type: "invoice.payment_failed", data: { object: { id: "in_1", object: "invoice", customer } } }));
    const { data: s2 } = await admin.from("subscriptions").select("status").eq("org_id", orgId).single();
    expect(s2!.status).toBe("past_due");
    // A past-due workspace cannot consume credits.
    const { data } = await admin.rpc("consume_credits", { p_org: orgId, p_kind: "search", p_quantity: 1, p_idempotency_key: `pd-${Date.now()}` });
    expect(data).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows up to the maximum per window, then blocks", async () => {
    const key = `test:${Date.now()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const { data } = await admin.rpc("rate_limit_hit", { p_key: key, p_window_seconds: 60, p_max: 3 });
      results.push(data as boolean);
    }
    expect(results).toEqual([true, true, true, false]);
    const denied = await owner.client.rpc("rate_limit_hit", { p_key: key, p_window_seconds: 60, p_max: 3 });
    expect(denied.error).not.toBeNull(); // not callable by end users
  });
});

describe("usage-based billing (start fee + monthly cost × markup)", () => {
  it("computes cost, applies the markup, enforces the cap and reports usage to Stripe", async () => {
    const { vi } = await import("vitest");
    const user = await createTestUser("usage");
    const org = await createOrgFor(user, `Usage Org ${Date.now()}`);
    await admin.from("subscriptions").update({ plan_key: "usage", status: "active", setup_paid_at: new Date(Date.now() - 86_400_000).toISOString(), usage_reported_until: new Date(Date.now() - 3_600_000).toISOString(), stripe_customer_id: `cus_usage_${Date.now()}`, limit_overrides: { spend_cap_cents: 1000 } }).eq("org_id", org);
    // €3.20 of provider cost this hour (cost_micros are millionths of a euro)
    await admin.from("api_usage").insert([
      { org_id: org, provider: "google_places", operation: "searchText", cost_micros: 3_200_000, status: "ok" },
      { org_id: org, provider: "openai", operation: "email", cost_micros: 1_000_000, status: "error" }, // failed calls are not billed
    ]);
    const { monthlySpend, consumeCredits } = await import("@/server/usage");
    const spend = await monthlySpend(org);
    expect(spend).toEqual({ costCents: 320, billableCents: 400, capCents: 1000 }); // markup 25%

    // Below the cap: allowed. Push cost over the cap (€10): blocked with SpendCapReachedError.
    await consumeCredits({ orgId: org, kind: "search", idempotencyKey: `cap-ok-${Date.now()}` });
    await admin.from("api_usage").insert({ org_id: org, provider: "openai", operation: "email", cost_micros: 5_000_000, status: "ok" });
    await expect(consumeCredits({ orgId: org, kind: "search", idempotencyKey: `cap-hit-${Date.now()}` })).rejects.toMatchObject({ name: "SpendCapReachedError" });

    // Stripe meter event: billable cents since the last report, once.
    const create = vi.fn(async () => ({}));
    vi.doMock("@/server/billing/stripe", () => ({ stripe: () => ({ billing: { meterEvents: { create } } }), stripeMode: () => "live" }));
    vi.resetModules();
    const { reportUsageToStripe } = await import("@/server/billing/service");
    await reportUsageToStripe();
    const mine = (create.mock.calls as unknown as [{ payload: { stripe_customer_id: string; value: string } }][]).filter(([e]) => e.payload.stripe_customer_id.startsWith("cus_usage_"));
    expect(mine.at(-1)?.[0].payload.value).toBe("1025"); // (320 + 500) × 1.25
    create.mockClear();
    await reportUsageToStripe();
    expect((create.mock.calls as unknown as [{ payload: { stripe_customer_id: string } }][]).filter(([e]) => e.payload.stripe_customer_id.startsWith("cus_usage_"))).toHaveLength(0);
    vi.doUnmock("@/server/billing/stripe");
  });
});

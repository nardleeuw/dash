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
    const sub = {
      id: "sub_test_1", object: "subscription", customer: "cus_test_1", status: "active", cancel_at_period_end: false, metadata: { orgId },
      items: { data: [{ price: { id: "price_test_growth" }, current_period_start: now, current_period_end: now + 30 * 86_400 }] },
    };
    expect((await POST(signedRequest({ id: `evt_sub_${Date.now()}`, object: "event", type: "customer.subscription.updated", data: { object: sub } }))).status).toBe(200);
    const { data: s1 } = await admin.from("subscriptions").select("plan_key, status, stripe_customer_id").eq("org_id", orgId).single();
    expect(s1).toEqual({ plan_key: "growth", status: "active", stripe_customer_id: "cus_test_1" });
    await POST(signedRequest({ id: `evt_inv_${Date.now()}`, object: "event", type: "invoice.payment_failed", data: { object: { id: "in_1", object: "invoice", customer: "cus_test_1" } } }));
    const { data: s2 } = await admin.from("subscriptions").select("status").eq("org_id", orgId).single();
    expect(s2!.status).toBe("past_due");
    // A past-due workspace cannot consume credits.
    const { data } = await admin.rpc("consume_credits", { p_org: orgId, p_kind: "search", p_quantity: 1, p_idempotency_key: `pd-${Date.now()}` });
    expect(data).toBe(false);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { admin, createOrgFor, createTestUser } from "./helpers";

process.env.MOCK_PROVIDERS = "kvk,google_places,osm,openai,hunter";
process.env.APP_ENV = "development";
process.env.JOBS_DISABLED = "1";
process.env.APP_URL = "https://app.example";

let orgId: string;
let campaignId: string;
let accountId: string;
let profileId: string;

async function approvedEmailFor(name: string, email: string, withPermission = true) {
  const { data: b } = await admin.from("businesses").insert({ org_id: orgId, name, kvk_number: String(Math.floor(10_000_000 + Math.random() * 89_999_999)) }).select("id").single();
  await admin.from("contacts").insert({ org_id: orgId, business_id: b!.id, email, email_type: "personal", recipient_category: "legal_entity_personal", email_verification: "valid", source: "manual" });
  if (withPermission) {
    await admin.from("email_permissions").insert({ org_id: orgId, email, business_id: b!.id, basis: "consent", recipient_category: "legal_entity_personal", purpose: "Informatie over AI-receptionisten", source: "Beursformulier", evidence: "Formulier 2026-11", obtained_at: "2026-11-01T00:00:00Z" });
  }
  const { data: e } = await admin.from("generated_emails").insert({
    org_id: orgId, business_id: b!.id, agency_profile_id: profileId, recipient_email: email, subject: `Vraag voor ${name}`, body: `Beste ${name},\n\nKorte vraag.\n\nGroet`,
    generation_status: "completed", review_status: "approved", fact_check: { passed: true, issues: [] }, is_mock: false,
  }).select("id").single();
  return { businessId: b!.id, emailId: e!.id };
}

beforeAll(async () => {
  const user = await createTestUser("sender");
  orgId = await createOrgFor(user, `Send Org ${Date.now()}`);
  await admin.from("organizations").update({ legal_name: "Studio Noord B.V.", kvk_number: "87654321", postal_address: "Straat 1, 3511 AA Utrecht", privacy_policy_url: "https://studionoord.nl/privacy" }).eq("id", orgId);
  const { data: p } = await admin.from("agency_profiles").select("id").eq("org_id", orgId).single();
  profileId = p!.id;
  const { data: acc } = await admin.from("email_accounts").insert({ org_id: orgId, provider: "mock", email_address: `out-${Date.now()}@studionoord.nl`, display_name: "Nard", is_mock: true, min_delay_seconds: 10, hourly_limit: 100, daily_limit: 100 }).select("id").single();
  accountId = acc!.id;
  const { data: seq } = await admin.from("follow_up_sequences").insert({ org_id: orgId, name: "Seq", steps: [{ step: 1, delay_days: 1 }] }).select("id").single();
  const { data: c } = await admin.from("campaigns").insert({
    org_id: orgId, name: "Test", email_account_id: accountId, agency_profile_id: profileId, follow_up_sequence_id: seq!.id,
    timezone: "UTC", send_days: [1, 2, 3, 4, 5, 6, 7], send_window_start: "00:00", send_window_end: "23:59", daily_limit: 50,
  }).select("id").single();
  campaignId = c!.id;
});

async function tick() {
  const { campaignTick } = await import("@/server/sending/tick");
  return campaignTick();
}
async function makeDue(recipientId: string, patch: Record<string, unknown> = {}) {
  await admin.from("campaign_recipients").update({ next_send_at: new Date(Date.now() - 1000).toISOString(), locked_until: null, ...patch }).eq("id", recipientId);
  await admin.from("email_accounts").update({ last_sent_at: null }).eq("id", accountId);
}

describe("campaign sending", () => {
  let recipientId: string;

  it("adds approved recipients and launches through the compliance gate", async () => {
    const { addRecipients, launchCampaign } = await import("@/server/sending/campaigns");
    const a = await approvedEmailFor("Bakkerij Een", "jan@bakkerij-een.nl");
    const b = await approvedEmailFor("Bakkerij Twee", "piet@bakkerij-twee.nl", false); // no legal basis: allowed (warning)
    const res = await addRecipients(orgId, campaignId, [a.emailId, b.emailId, a.emailId]);
    expect(res.added).toBe(2);
    // An unsubscribed address is always blocked.
    await admin.from("suppression_records").insert({ org_id: orgId, email: "piet@bakkerij-twee.nl", reason: "unsubscribe", source: "test" });
    const launch = await launchCampaign(orgId, campaignId);
    expect(launch).toMatchObject({ activated: 1, blocked: { suppressed: 1 } });
    const { data: rs } = await admin.from("campaign_recipients").select("id, email, status, stop_reason").eq("campaign_id", campaignId);
    expect(rs!.find((r) => r.email === "piet@bakkerij-twee.nl")).toMatchObject({ status: "stopped", stop_reason: "suppressed" });
    recipientId = rs!.find((r) => r.email === "jan@bakkerij-een.nl")!.id;
  });

  it("sends one individually addressed message with footer and unsubscribe header", async () => {
    const { MockMailProvider } = await import("@/server/sending/providers/mock");
    await makeDue(recipientId);
    const out = await tick();
    expect(out.sent).toBe(1);
    const msg = MockMailProvider.sent.at(-1)!;
    expect(msg.to).toBe("jan@bakkerij-een.nl");
    expect(msg.text).toContain("KVK 87654321");
    expect(msg.headers["List-Unsubscribe"]).toContain("https://app.example/api/unsubscribe/");
    const { data: r } = await admin.from("campaign_recipients").select("current_step, status, next_send_at").eq("id", recipientId).single();
    expect(r).toMatchObject({ current_step: 1, status: "active" });
    expect(new Date(r!.next_send_at).getTime()).toBeGreaterThan(Date.now() + 20 * 3_600_000); // follow-up after ~1 day
    const { data: b } = await admin.from("businesses").select("lead_status").eq("name", "Bakkerij Een").eq("org_id", orgId).single();
    expect(b!.lead_status).toBe("contacted");
  });

  it("never sends the same step twice", async () => {
    await makeDue(recipientId, { current_step: 0 });
    const out = await tick();
    expect(out.already_processed).toBe(1);
    const { count } = await admin.from("outbound_messages").select("id", { count: "exact", head: true }).eq("campaign_recipient_id", recipientId);
    expect(count).toBe(1);
  });

  it("waits for follow-up approval instead of sending unreviewed content", async () => {
    await makeDue(recipientId, { current_step: 1 });
    const out = await tick();
    expect(out.awaiting_approval).toBe(1);
  });

  it("stops everything after an unsubscribe", async () => {
    const { MockMailProvider } = await import("@/server/sending/providers/mock");
    const { handleUnsubscribe } = await import("@/server/compliance/unsubscribe-handler");
    const token = MockMailProvider.sent.at(-1)!.unsubscribeUrl.split("/u/")[1];
    const res = await handleUnsubscribe(token, "one_click");
    expect(res).toMatchObject({ ok: true, stopped: 1 });
    const { data: r } = await admin.from("campaign_recipients").select("status").eq("id", recipientId).single();
    expect(r!.status).toBe("unsubscribed");
    const { data: sup } = await admin.from("suppression_records").select("reason").eq("org_id", orgId).eq("email", "jan@bakkerij-een.nl").single();
    expect(sup!.reason).toBe("unsubscribe");
    expect(await handleUnsubscribe(token.replace(/.$/, "x"))).toEqual({ ok: false });
  });

  it("handles a hard bounce: suppress and stop", async () => {
    const { addRecipients } = await import("@/server/sending/campaigns");
    const c = await approvedEmailFor("Bakkerij Drie", "bounce@bakkerij-drie.nl");
    await addRecipients(orgId, campaignId, [c.emailId]);
    const { data: r } = await admin.from("campaign_recipients").select("id").eq("campaign_id", campaignId).eq("email", "bounce@bakkerij-drie.nl").single();
    await makeDue(r!.id, { status: "active" });
    const out = await tick();
    expect(out.bounced).toBe(1);
    const { data: rec } = await admin.from("campaign_recipients").select("status").eq("id", r!.id).single();
    expect(rec!.status).toBe("bounced");
    const { data: sup } = await admin.from("suppression_records").select("reason").eq("org_id", orgId).eq("email", "bounce@bakkerij-drie.nl").single();
    expect(sup!.reason).toBe("hard_bounce");
  });

  it("does not re-add an address contacted in the last 90 days", async () => {
    const { addRecipients } = await import("@/server/sending/campaigns");
    const { data: c2 } = await admin.from("campaigns").insert({ org_id: orgId, name: "Second", email_account_id: accountId, agency_profile_id: profileId }).select("id").single();
    const { data: e } = await admin.from("generated_emails").select("id").eq("org_id", orgId).eq("recipient_email", "jan@bakkerij-een.nl").single();
    const res = await addRecipients(orgId, c2!.id, [e!.id]);
    expect(res).toMatchObject({ added: 0, reasons: { recently_contacted: 1 } });
  });

  it("pauses and cancels", async () => {
    const { pauseCampaign, cancelCampaign } = await import("@/server/sending/campaigns");
    expect(await pauseCampaign(orgId, campaignId)).toEqual({ paused: true });
    await cancelCampaign(orgId, campaignId);
    const { data } = await admin.from("campaigns").select("status").eq("id", campaignId).single();
    expect(data!.status).toBe("cancelled");
  });
});

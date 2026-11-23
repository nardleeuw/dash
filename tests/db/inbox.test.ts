import { beforeAll, describe, expect, it } from "vitest";
import { admin, createOrgFor, createTestUser } from "./helpers";

process.env.MOCK_PROVIDERS = "kvk,google_places,osm,openai,hunter";
process.env.APP_ENV = "development";
process.env.JOBS_DISABLED = "1";
process.env.APP_URL = "https://app.example";

let orgId: string;
let userId: string;
let accountId: string;
let campaignId: string;
const sent: Record<string, { recipientId: string; messageId: string; businessId: string }> = {};

beforeAll(async () => {
  const user = await createTestUser("inbox");
  userId = user.id;
  orgId = await createOrgFor(user, `Inbox Org ${Date.now()}`);
  await admin.from("organizations").update({ legal_name: "Studio Noord B.V." }).eq("id", orgId);
  const { data: p } = await admin.from("agency_profiles").select("id").eq("org_id", orgId).single();
  const { data: acc } = await admin.from("email_accounts").insert({ org_id: orgId, provider: "mock", email_address: `inbox-${Date.now()}@studionoord.nl`, is_mock: true, min_delay_seconds: 10 }).select("id").single();
  accountId = acc!.id;
  const { data: seq } = await admin.from("follow_up_sequences").insert({ org_id: orgId, name: "S", steps: [{ step: 1, delay_days: 2 }] }).select("id").single();
  const { data: c } = await admin.from("campaigns").insert({ org_id: orgId, name: "Inbox", email_account_id: accountId, agency_profile_id: p!.id, follow_up_sequence_id: seq!.id, timezone: "UTC", send_days: [1, 2, 3, 4, 5, 6, 7], send_window_start: "00:00", send_window_end: "23:59", daily_limit: 50 }).select("id").single();
  campaignId = c!.id;
  const { addRecipients, launchCampaign } = await import("@/server/sending/campaigns");
  const { campaignTick } = await import("@/server/sending/tick");
  const ids: string[] = [];
  for (const key of ["jan", "ooo", "stop", "bye"]) {
    const email = `${key}@klant-${key}.nl`;
    const { data: b } = await admin.from("businesses").insert({ org_id: orgId, name: `Klant ${key}` }).select("id").single();
    await admin.from("contacts").insert({ org_id: orgId, business_id: b!.id, email, email_type: "personal", recipient_category: "legal_entity_personal", email_verification: "valid", source: "manual" });
    await admin.from("email_permissions").insert({ org_id: orgId, email, basis: "consent", recipient_category: "legal_entity_personal", purpose: "x", source: "x", evidence: "x", obtained_at: "2026-01-01T00:00:00Z" });
    const { data: e } = await admin.from("generated_emails").insert({ org_id: orgId, business_id: b!.id, agency_profile_id: p!.id, recipient_email: email, subject: `Vraag ${key}`, body: "Body", generation_status: "completed", review_status: "approved", fact_check: { passed: true } }).select("id").single();
    ids.push(e!.id);
  }
  await addRecipients(orgId, campaignId, ids);
  await launchCampaign(orgId, campaignId);
  for (let i = 0; i < 4; i++) {
    await admin.from("campaign_recipients").update({ next_send_at: new Date(Date.now() - 1000).toISOString() }).eq("campaign_id", campaignId).eq("status", "active").eq("current_step", 0);
    await admin.from("email_accounts").update({ last_sent_at: null }).eq("id", accountId);
    await campaignTick(1);
  }
  const { data: outs } = await admin.from("outbound_messages").select("to_email, message_id_header, campaign_recipient_id, business_id").eq("campaign_id", campaignId);
  for (const o of outs ?? []) sent[o.to_email.split("@")[0]] = { recipientId: o.campaign_recipient_id!, messageId: o.message_id_header, businessId: o.business_id! };
});

const inbound = (from: string, inReplyTo: string | null, text: string, extra: Record<string, unknown> = {}) => ({
  messageId: `<${Math.random().toString(36).slice(2)}@klant.nl>`, inReplyTo, references: inReplyTo ? [inReplyTo] : [], from, fromName: "Jan", to: null,
  subject: "Re: Vraag", text, receivedAt: new Date(), isAutoReply: false, isBounce: false, bouncedRecipient: null, ...extra,
});

describe("inbound reply processing", () => {
  it("matches by In-Reply-To, stops the sequence and updates the CRM", async () => {
    expect(Object.keys(sent).sort()).toEqual(["bye", "jan", "ooo", "stop"]);
    const { ingestInbound } = await import("@/server/inbox/ingest");
    const msg = inbound("jan@klant-jan.nl", sent.jan.messageId, "Klinkt interessant! Kunnen we dinsdag bellen?");
    const res = await ingestInbound(orgId, accountId, msg);
    expect(res).toMatchObject({ category: "meeting_request", matchedBy: "in_reply_to" });
    const { data: r } = await admin.from("campaign_recipients").select("status, next_send_at").eq("id", sent.jan.recipientId).single();
    expect(r).toMatchObject({ status: "replied", next_send_at: null });
    const { data: b } = await admin.from("businesses").select("lead_status").eq("id", sent.jan.businessId).single();
    expect(b!.lead_status).toBe("interested");
    const { count: tasks } = await admin.from("tasks").select("id", { count: "exact", head: true }).eq("business_id", sent.jan.businessId);
    expect(tasks).toBe(1);
    const { data: conv } = await admin.from("conversations").select("needs_attention, latest_category").eq("campaign_recipient_id", sent.jan.recipientId).single();
    expect(conv).toMatchObject({ needs_attention: true, latest_category: "meeting_request" });
    // idempotent
    expect(await ingestInbound(orgId, accountId, msg)).toEqual({ skipped: "duplicate" });
  });

  it("postpones (not stops) on out-of-office", async () => {
    const { ingestInbound } = await import("@/server/inbox/ingest");
    const before = await admin.from("campaign_recipients").select("next_send_at").eq("id", sent.ooo.recipientId).single();
    await ingestInbound(orgId, accountId, inbound("ooo@klant-ooo.nl", sent.ooo.messageId, "Ik ben afwezig.", { isAutoReply: true }));
    const { data: r } = await admin.from("campaign_recipients").select("status, next_send_at").eq("id", sent.ooo.recipientId).single();
    expect(r!.status).toBe("active");
    expect(new Date(r!.next_send_at).getTime()).toBeGreaterThan(new Date(before.data!.next_send_at).getTime());
  });

  it("suppresses on an unsubscribe reply (matched by sender)", async () => {
    const { ingestInbound } = await import("@/server/inbox/ingest");
    const res = await ingestInbound(orgId, accountId, inbound("stop@klant-stop.nl", null, "Wilt u mij afmelden? Niet meer mailen."));
    expect(res).toMatchObject({ category: "unsubscribe", matchedBy: "sender" });
    const { data: s } = await admin.from("suppression_records").select("reason").eq("org_id", orgId).eq("email", "stop@klant-stop.nl").single();
    expect(s!.reason).toBe("unsubscribe");
  });

  it("handles delivery status notifications as bounces", async () => {
    const { ingestInbound } = await import("@/server/inbox/ingest");
    await ingestInbound(orgId, accountId, inbound("mailer-daemon@mx.klant.nl", null, "550 user unknown", { isBounce: true, bouncedRecipient: "bye@klant-bye.nl" }));
    const { data: r } = await admin.from("campaign_recipients").select("status").eq("id", sent.bye.recipientId).single();
    expect(r!.status).toBe("bounced");
  });

  it("ignores mail unrelated to outreach", async () => {
    const { ingestInbound } = await import("@/server/inbox/ingest");
    expect(await ingestInbound(orgId, accountId, inbound("random@elders.nl", null, "Factuur"))).toEqual({ skipped: "unmatched" });
  });

  it("lets a user reply in the thread (explicitly)", async () => {
    const { sendConversationReply } = await import("@/server/inbox/reply");
    const { data: conv } = await admin.from("conversations").select("id").eq("campaign_recipient_id", sent.jan.recipientId).single();
    const res = await sendConversationReply(orgId, userId, conv!.id, "Dinsdag 10:00 past prima, ik bel u dan.");
    expect(res).toEqual({ ok: true });
    const { data: out } = await admin.from("outbound_messages").select("in_reply_to, subject, conversation_id").eq("conversation_id", conv!.id).is("campaign_recipient_id", null).single();
    expect(out!.subject).toMatch(/^Re: /);
    expect(out!.in_reply_to).toBeTruthy();
    const { data: c2 } = await admin.from("conversations").select("needs_attention").eq("id", conv!.id).single();
    expect(c2!.needs_attention).toBe(false);
  });
});

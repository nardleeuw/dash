import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { evaluateRecipient, loadSenderContext } from "@/server/compliance/evaluate";
import { dispatch } from "@/server/jobs/dispatch";
import { spreadSchedule } from "./schedule";

const RECENT_CONTACT_DAYS = 90;

/**
 * Add approved initial emails to a campaign. Skips addresses already in the
 * campaign and addresses contacted by this workspace in the last 90 days.
 */
export async function addRecipients(orgId: string, campaignId: string, generatedEmailIds: string[]) {
  const admin = createAdminClient();
  const { data: c } = await admin.from("campaigns").select("id, status, agency_profile_id").eq("id", campaignId).eq("org_id", orgId).single();
  if (!c || ["completed", "cancelled"].includes(c.status)) return { added: 0, skipped: generatedEmailIds.length, reasons: { campaign_closed: generatedEmailIds.length } };
  const { data: emails } = await admin
    .from("generated_emails")
    .select("id, business_id, contact_id, recipient_email, review_status, generation_status, sequence_step")
    .eq("org_id", orgId)
    .in("id", generatedEmailIds);
  const since = new Date(Date.now() - RECENT_CONTACT_DAYS * 86_400_000).toISOString();
  const reasons: Record<string, number> = {};
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const e of emails ?? []) {
    const skip = (k: string) => (reasons[k] = (reasons[k] ?? 0) + 1);
    if (e.sequence_step !== 0) { skip("not_initial"); continue; }
    if (e.generation_status !== "completed" || e.review_status !== "approved") { skip("not_approved"); continue; }
    const email = e.recipient_email?.toLowerCase();
    if (!email) { skip("no_recipient"); continue; }
    if (seen.has(email)) { skip("duplicate"); continue; }
    const { count } = await admin.from("outbound_messages").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("to_email", email).gte("sent_at", since);
    if ((count ?? 0) > 0) { skip("recently_contacted"); continue; }
    seen.add(email);
    rows.push({ org_id: orgId, campaign_id: campaignId, business_id: e.business_id, contact_id: e.contact_id, email, generated_email_id: e.id, status: "pending" });
  }
  let added = 0;
  if (rows.length) {
    const { data, error } = await admin.from("campaign_recipients").upsert(rows, { onConflict: "campaign_id,email", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    added = data?.length ?? 0;
    if (added < rows.length) reasons.already_in_campaign = rows.length - added;
  }
  return { added, skipped: (emails?.length ?? 0) - added + (generatedEmailIds.length - (emails?.length ?? 0)), reasons };
}

/** Validate and start a campaign: every recipient passes the hard gate or is stopped with reasons. */
export async function launchCampaign(orgId: string, campaignId: string) {
  const admin = createAdminClient();
  const { data: c } = await admin.from("campaigns").select("*").eq("id", campaignId).eq("org_id", orgId).single();
  if (!c) return { error: "not_found" as const };
  if (!["draft", "scheduled", "paused"].includes(c.status)) return { error: "invalid_status" as const };
  if (!c.email_account_id) return { error: "no_account" as const };
  const { data: account } = await admin.from("email_accounts").select("status, min_delay_seconds, is_mock").eq("id", c.email_account_id).single();
  if (!account || account.status !== "active") return { error: "account_inactive" as const };

  const sender = await loadSenderContext(admin, orgId);
  if (!sender.senderIdentityComplete) return { error: "sender_identity" as const };

  const { data: recipients } = await admin.from("campaign_recipients").select("id, business_id, email, generated_email_id, status").eq("campaign_id", campaignId).eq("status", "pending");
  const eligibleIds: string[] = [];
  const blocked: Record<string, number> = {};
  for (const r of recipients ?? []) {
    const { data: email } = await admin.from("generated_emails").select("is_mock, review_status, fact_check").eq("id", r.generated_email_id).single();
    const gate = await evaluateRecipient(admin, orgId, {
      email: r.email, businessId: r.business_id, isMockContent: Boolean(email?.is_mock), sender,
      sendTime: { reviewApproved: email?.review_status === "approved", factCheckPassed: Boolean((email?.fact_check as { passed?: boolean } | null)?.passed), accountIsMock: account.is_mock },
    });
    if (gate.eligible) eligibleIds.push(r.id);
    else {
      const codes = gate.reasons.filter((x) => x.severity === "block").map((x) => x.code);
      codes.forEach((k) => (blocked[k] = (blocked[k] ?? 0) + 1));
      await admin.from("campaign_recipients").update({ status: "stopped", stop_reason: codes.join(",") }).eq("id", r.id);
    }
  }

  const start = c.starts_at && new Date(c.starts_at) > new Date() ? new Date(c.starts_at) : new Date();
  const times = spreadSchedule(eligibleIds.length, start, { timezone: c.timezone, sendDays: c.send_days, start: c.send_window_start.slice(0, 5), end: c.send_window_end.slice(0, 5) }, c.daily_limit, account.min_delay_seconds);
  for (let i = 0; i < eligibleIds.length; i++) {
    await admin.from("campaign_recipients").update({ status: "active", next_send_at: times[i].toISOString(), stop_reason: null }).eq("id", eligibleIds[i]);
  }
  // Resume previously active recipients too (after a pause).
  await admin.from("campaigns").update({ status: "running", launched_at: c.launched_at ?? new Date().toISOString(), paused_at: null }).eq("id", campaignId);
  return { activated: eligibleIds.length, blocked };
}

export async function pauseCampaign(orgId: string, campaignId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("campaigns").update({ status: "paused", paused_at: new Date().toISOString() }).eq("id", campaignId).eq("org_id", orgId).eq("status", "running").select("id");
  return { paused: (data?.length ?? 0) > 0 };
}

export async function resumeCampaign(orgId: string, campaignId: string) {
  const admin = createAdminClient();
  const { data: pending } = await admin.from("campaign_recipients").select("id", { count: "exact" }).eq("campaign_id", campaignId).eq("status", "pending");
  if ((pending?.length ?? 0) > 0) return launchCampaign(orgId, campaignId);
  const { data } = await admin.from("campaigns").update({ status: "running", paused_at: null }).eq("id", campaignId).eq("org_id", orgId).eq("status", "paused").select("id");
  return { resumed: (data?.length ?? 0) > 0 };
}

export async function cancelCampaign(orgId: string, campaignId: string) {
  const admin = createAdminClient();
  await admin.from("campaigns").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", campaignId).eq("org_id", orgId).in("status", ["draft", "scheduled", "running", "paused"]);
  await admin.from("campaign_recipients").update({ status: "cancelled", next_send_at: null, stop_reason: "campaign_cancelled" }).eq("campaign_id", campaignId).in("status", ["pending", "active"]);
  await admin.from("outbound_messages").update({ status: "cancelled" }).eq("campaign_id", campaignId).eq("status", "queued");
  return { cancelled: true };
}

/** Create follow-up email rows for every recipient and each sequence step, then generate them. */
export async function generateFollowUps(orgId: string, campaignId: string, userId: string | null) {
  const admin = createAdminClient();
  const { data: c } = await admin.from("campaigns").select("id, agency_profile_id, follow_up_sequence_id").eq("id", campaignId).eq("org_id", orgId).single();
  if (!c?.follow_up_sequence_id || !c.agency_profile_id) return { error: "no_sequence" as const };
  const { data: seq } = await admin.from("follow_up_sequences").select("steps").eq("id", c.follow_up_sequence_id).single();
  const steps = ((seq?.steps ?? []) as { step: number; instructions?: string | null }[]).filter((s) => s.step >= 1);
  const { data: recipients } = await admin.from("campaign_recipients").select("business_id, contact_id, email").eq("campaign_id", campaignId).in("status", ["pending", "active"]);
  const { data: profile } = await admin.from("agency_profiles").select("language").eq("id", c.agency_profile_id).single();
  const { data: batch } = await admin.from("email_generation_batches").insert({ org_id: orgId, agency_profile_id: c.agency_profile_id, source: "regenerate", source_ref: { campaignId, followUps: true }, mode: "missing_only", language: profile?.language ?? "nl", status: "running", created_by: userId, name: "Follow-ups" }).select("id").single();
  let queued = 0;
  for (const r of recipients ?? []) {
    for (const s of steps) {
      const { error } = await admin.from("generated_emails").insert({
        org_id: orgId, batch_id: batch!.id, business_id: r.business_id, contact_id: r.contact_id, recipient_email: r.email, agency_profile_id: c.agency_profile_id,
        campaign_id: campaignId, sequence_step: s.step, language: profile?.language ?? "nl", generation_status: "queued", opportunity: s.instructions ? { instructions: s.instructions } : null,
      });
      if (!error) queued++; // unique index skips existing follow-ups
    }
  }
  await admin.from("email_generation_batches").update({ total: queued, status: queued ? "running" : "completed" }).eq("id", batch!.id);
  if (queued) await dispatch("emails/batch.created", { orgId, userId, batchId: batch!.id });
  return { queued };
}

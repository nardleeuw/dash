import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/server/supabase/admin";
import { env } from "@/server/env";
import { evaluateRecipient, loadSenderContext } from "@/server/compliance/evaluate";
import { providerFor, type EmailAccountRow } from "./accounts";
import { accountCapacity } from "./limits";
import { composeMessage, type SenderIdentity } from "./compose";
import { ensureSignOff } from "@/server/emails/signoff";
import { followUpTime, isWithinWindow, nextWindowStart, type Window } from "./schedule";
import { SendError } from "./providers/types";
import { senderIdentityComplete } from "@/server/compliance/identity";

type Recipient = { id: string; org_id: string; campaign_id: string; business_id: string; contact_id: string | null; email: string; generated_email_id: string; status: string; current_step: number };
type Campaign = { id: string; org_id: string; status: string; email_account_id: string | null; agency_profile_id: string | null; follow_up_sequence_id: string | null; timezone: string; send_days: number[]; send_window_start: string; send_window_end: string; daily_limit: number };

const STALE_SENDING_MINUTES = 15;
const MAX_ATTEMPTS = 3;

function windowOf(c: Campaign): Window {
  return { timezone: c.timezone, sendDays: c.send_days, start: c.send_window_start.slice(0, 5), end: c.send_window_end.slice(0, 5) };
}

async function release(admin: SupabaseClient, recipientId: string, patch: Record<string, unknown> = {}) {
  await admin.from("campaign_recipients").update({ locked_until: null, ...patch }).eq("id", recipientId);
}

async function senderIdentity(admin: SupabaseClient, orgId: string, language: "nl" | "en"): Promise<SenderIdentity | null> {
  const [{ data: org }, { data: notice }] = await Promise.all([
    admin.from("organizations").select("legal_name, privacy_policy_url").eq("id", orgId).single(),
    admin.from("privacy_notices").select("email_footer, url").eq("org_id", orgId).eq("is_active", true).eq("language", language).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!org || !senderIdentityComplete(org)) return null;
  return { legalName: org.legal_name!, privacyUrl: notice?.url ?? org.privacy_policy_url, footerText: notice?.email_footer ?? null, language };
}

/**
 * Messages stuck in "sending" have an unknown outcome: never resend automatically —
 * unless the mailbox cannot log in and has never sent anything, in which case the
 * message cannot have gone out and simply waits for the mailbox to be fixed.
 */
async function recoverStale(admin: SupabaseClient) {
  const cutoff = new Date(Date.now() - STALE_SENDING_MINUTES * 60_000).toISOString();
  const { data: stuck } = await admin.from("outbound_messages").select("id, campaign_recipient_id, email_account_id").eq("status", "sending").lt("updated_at", cutoff);
  if (!stuck?.length) return;
  const accountIds = [...new Set(stuck.map((m) => m.email_account_id).filter(Boolean))] as string[];
  const { data: accounts } = accountIds.length ? await admin.from("email_accounts").select("id, status, last_sent_at").in("id", accountIds) : { data: [] };
  const neverSent = new Set((accounts ?? []).filter((a) => a.status === "error" && !a.last_sent_at).map((a) => a.id));
  for (const m of stuck) {
    if (m.email_account_id && neverSent.has(m.email_account_id)) {
      const { data: done } = await admin.from("outbound_messages").update({ status: "failed", error: "mailbox_login_failed" }).eq("id", m.id).eq("status", "sending").select("id");
      if (done?.length && m.campaign_recipient_id) await release(admin, m.campaign_recipient_id, { next_send_at: new Date(Date.now() + 3_600_000).toISOString() });
      continue;
    }
    const { data: done } = await admin.from("outbound_messages").update({ status: "failed", error: "unknown_outcome_manual_check" }).eq("id", m.id).eq("status", "sending").select("id");
    if (done?.length && m.campaign_recipient_id) await release(admin, m.campaign_recipient_id, { status: "stopped", stop_reason: "unknown_send_outcome" });
  }
}

/** One scheduler pass: claim due recipients and send at most one message each. */
export async function campaignTick(limit = 50) {
  const admin = createAdminClient();
  await recoverStale(admin);
  const { data: due, error } = await admin.rpc("claim_due_recipients", { p_limit: limit });
  if (error) throw error;
  const results: Record<string, number> = {};
  for (const r of (due ?? []) as Recipient[]) {
    const outcome = await processRecipient(admin, r).catch(async (err) => {
      console.error("[tick] recipient failed", r.id, err);
      await release(admin, r.id, { next_send_at: new Date(Date.now() + 15 * 60_000).toISOString() });
      return "error";
    });
    results[outcome] = (results[outcome] ?? 0) + 1;
  }
  return results;
}

export async function processRecipient(admin: SupabaseClient, r: Recipient): Promise<string> {
  const now = new Date();
  const { data: c } = await admin.from("campaigns").select("*").eq("id", r.campaign_id).single<Campaign>();
  if (!c || c.status !== "running") {
    await release(admin, r.id);
    return "campaign_not_running";
  }
  const w = windowOf(c);
  if (!isWithinWindow(now, w)) {
    await release(admin, r.id, { next_send_at: nextWindowStart(now, w).toISOString() });
    return "outside_window";
  }
  const { data: account } = await admin.from("email_accounts").select("*").eq("id", c.email_account_id).single<EmailAccountRow>();
  if (!account || account.status !== "active") {
    await release(admin, r.id, { next_send_at: new Date(now.getTime() + 3_600_000).toISOString() });
    return "account_unavailable";
  }
  const capacity = await accountCapacity(admin, account, now);
  if (!capacity.ok) {
    await release(admin, r.id, { next_send_at: capacity.retryAt.toISOString() });
    return capacity.reason;
  }
  const dayStart = new Date(now.getTime() - 86_400_000).toISOString();
  const { count: campaignToday } = await admin.from("outbound_messages").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).gte("sent_at", dayStart);
  if ((campaignToday ?? 0) >= c.daily_limit) {
    await release(admin, r.id, { next_send_at: nextWindowStart(new Date(now.getTime() + 12 * 3_600_000), w).toISOString() });
    return "campaign_daily_limit";
  }

  // The email for this step.
  const step = r.current_step;
  const { data: email } = step === 0
    ? await admin.from("generated_emails").select("*").eq("id", r.generated_email_id).single()
    : await admin.from("generated_emails").select("*").eq("org_id", r.org_id).eq("campaign_id", c.id).eq("business_id", r.business_id).eq("sequence_step", step).maybeSingle();
  if (!email || email.generation_status !== "completed" || email.review_status !== "approved") {
    // Follow-ups must be reviewed too; wait for approval rather than sending unreviewed content.
    await release(admin, r.id, { next_send_at: new Date(now.getTime() + 24 * 3_600_000).toISOString(), stop_reason: "awaiting_approval" });
    return "awaiting_approval";
  }

  // Hard gate, re-evaluated at send time.
  const sender = await loadSenderContext(admin, r.org_id);
  const gate = await evaluateRecipient(admin, r.org_id, {
    email: r.email, businessId: r.business_id, isMockContent: email.is_mock, sender,
    sendTime: { reviewApproved: email.review_status === "approved", factCheckPassed: Boolean((email.fact_check as { passed?: boolean } | null)?.passed), accountIsMock: account.is_mock },
  });
  if (!gate.eligible) {
    const codes = gate.reasons.filter((x) => x.severity === "block").map((x) => x.code);
    const status = codes.includes("suppressed") ? "unsubscribed" : "stopped";
    await release(admin, r.id, { status, stop_reason: codes.join(","), next_send_at: null });
    return "blocked";
  }
  const identity = await senderIdentity(admin, r.org_id, email.language === "en" ? "en" : "nl");
  if (!identity) {
    await release(admin, r.id, { status: "stopped", stop_reason: "sender_identity" });
    return "blocked";
  }

  // Threading for follow-ups.
  let thread: { inReplyTo: string; references: string[] } | null = null;
  let subject = email.subject as string;
  if (step > 0) {
    const { data: prev } = await admin.from("outbound_messages").select("message_id_header, subject").eq("campaign_recipient_id", r.id).eq("sequence_step", step - 1).eq("status", "sent").maybeSingle();
    if (prev) {
      thread = { inReplyTo: prev.message_id_header, references: [prev.message_id_header] };
      subject = prev.subject.replace(/^re:\s*/i, "");
    }
  }

  // Emails written before sign-offs were guaranteed still get a greeting and name.
  const { data: profile } = email.agency_profile_id
    ? await admin.from("agency_profiles").select("signature, sender_name, agency_name, language, formality, website").eq("id", email.agency_profile_id).maybeSingle()
    : { data: null };
  const body = profile ? ensureSignOff(email.body as string, { ...profile, language: profile.language === "en" ? "en" : "nl", formality: profile.formality === "informal" ? "informal" : "formal" }) : (email.body as string);

  const msg = composeMessage({
    orgId: r.org_id, appUrl: env().APP_URL, from: { name: account.display_name, email: account.email_address }, to: r.email,
    subject, body, identity, thread,
  });

  // Duplicate-send guard: exactly one outbound row per (recipient, step).
  const { data: existing } = await admin.from("outbound_messages").select("id, status, attempts").eq("campaign_recipient_id", r.id).eq("sequence_step", step).maybeSingle();
  let messageRowId: string;
  if (existing) {
    if (existing.status !== "failed" || existing.attempts >= MAX_ATTEMPTS) {
      await release(admin, r.id);
      return "already_processed";
    }
    const { data: claimed } = await admin.from("outbound_messages").update({ status: "sending", message_id_header: msg.messageId, error: null }).eq("id", existing.id).eq("status", "failed").select("id").maybeSingle();
    if (!claimed) {
      await release(admin, r.id);
      return "already_processed";
    }
    messageRowId = existing.id;
  } else {
    const { data: inserted, error: insErr } = await admin
      .from("outbound_messages")
      .insert({
        org_id: r.org_id, campaign_id: c.id, campaign_recipient_id: r.id, business_id: r.business_id, contact_id: r.contact_id,
        generated_email_id: email.id, email_account_id: account.id, sequence_step: step, to_email: r.email, from_email: account.email_address,
        subject: msg.subject, body_text: msg.text, message_id_header: msg.messageId, in_reply_to: msg.inReplyTo, status: "sending",
        is_mock: account.is_mock, scheduled_for: now.toISOString(),
      })
      .select("id")
      .single();
    if (insErr) {
      await release(admin, r.id);
      return insErr.code === "23505" ? "already_processed" : "insert_failed";
    }
    messageRowId = inserted.id;
  }

  // Sending consumes "send" credits (idempotent per outbound row).
  const { consumeCredits, CreditsExhaustedError } = await import("@/server/usage");
  try {
    await consumeCredits({ orgId: r.org_id, kind: "send", idempotencyKey: `send:${messageRowId}`, referenceType: "outbound_message", referenceId: messageRowId });
  } catch (err) {
    if (err instanceof CreditsExhaustedError) {
      await admin.from("outbound_messages").update({ status: "failed", error: "send_credits_exhausted", attempts: MAX_ATTEMPTS - 1 }).eq("id", messageRowId);
      await release(admin, r.id, { next_send_at: new Date(now.getTime() + 6 * 3_600_000).toISOString(), stop_reason: "send_credits_exhausted" });
      return "credits_exhausted";
    }
    throw err;
  }

  try {
    const provider = await providerFor(admin, account);
    const res = await provider.send(msg);
    const sentAt = new Date().toISOString();
    await admin.from("outbound_messages").update({
      status: "sent", sent_at: sentAt, provider_message_id: res.providerMessageId, thread_id: res.threadId ?? null,
      message_id_header: res.messageIdHeader ?? msg.messageId, attempts: (existing?.attempts ?? 0) + 1,
    }).eq("id", messageRowId);
    await admin.from("email_events").insert({ org_id: r.org_id, outbound_message_id: messageRowId, email_account_id: account.id, type: "sent", provider: account.provider, occurred_at: sentAt });
    await admin.from("email_accounts").update({ last_sent_at: sentAt, last_error: null }).eq("id", account.id);

    // Schedule the next step or complete.
    const { data: seq } = c.follow_up_sequence_id ? await admin.from("follow_up_sequences").select("steps").eq("id", c.follow_up_sequence_id).single() : { data: null };
    const steps = ((seq?.steps ?? []) as { step: number; delay_days: number }[]).sort((a, b) => a.step - b.step);
    const next = steps.find((s) => s.step === step + 1);
    await release(admin, r.id, next
      ? { current_step: step + 1, last_sent_at: sentAt, next_send_at: followUpTime(new Date(sentAt), next.delay_days, w).toISOString(), stop_reason: null }
      : { current_step: step + 1, last_sent_at: sentAt, next_send_at: null, status: "completed", stop_reason: null });

    const { data: biz } = await admin.from("businesses").select("lead_status").eq("id", r.business_id).single();
    if (biz && ["new", "enriched", "qualified", "approved"].includes(biz.lead_status)) {
      await admin.from("businesses").update({ lead_status: "contacted" }).eq("id", r.business_id);
    }
    await admin.from("activities").insert({ org_id: r.org_id, business_id: r.business_id, contact_id: r.contact_id, type: "email_sent", data: { campaign_id: c.id, step, message_id: messageRowId } });
    return "sent";
  } catch (err) {
    const e = err instanceof SendError ? err : new SendError((err as Error).message, "temporary");
    const attempts = (existing?.attempts ?? 0) + 1;
    if (e.kind === "permanent") {
      await admin.from("outbound_messages").update({ status: "bounced", error: e.message.slice(0, 500), attempts }).eq("id", messageRowId);
      await admin.from("email_events").insert({ org_id: r.org_id, outbound_message_id: messageRowId, email_account_id: account.id, type: "bounced_hard", provider: account.provider, payload: { code: e.code, message: e.message.slice(0, 300) } });
      await admin.from("suppression_records").upsert({ org_id: r.org_id, email: r.email, reason: "hard_bounce", source: "send_error", campaign_id: c.id }, { onConflict: "org_id,email", ignoreDuplicates: true });
      await release(admin, r.id, { status: "bounced", stop_reason: "hard_bounce", next_send_at: null });
      return "bounced";
    }
    await admin.from("outbound_messages").update({ status: "failed", error: e.message.slice(0, 500), attempts }).eq("id", messageRowId);
    if (e.kind === "auth") {
      await admin.from("email_accounts").update({ status: "error", last_error: e.message.slice(0, 300) }).eq("id", account.id);
      await release(admin, r.id, { next_send_at: new Date(now.getTime() + 3_600_000).toISOString() });
      return "account_error";
    }
    if (attempts >= MAX_ATTEMPTS) {
      await release(admin, r.id, { status: "failed", stop_reason: "send_failed", next_send_at: null });
      return "failed";
    }
    await release(admin, r.id, { next_send_at: new Date(now.getTime() + 15 * 60_000 * attempts).toISOString() });
    return "retry";
  }
}

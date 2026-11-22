import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/server/supabase/admin";
import type { InboundMessage } from "@/server/sending/providers/types";
import { structured, AiUnavailableError } from "@/server/ai/client";
import { heuristicReply, replySchema, replySystemPrompt, replyUserPrompt, type ReplyOutput } from "@/server/ai/prompts/reply";
import { suppressAddress } from "@/server/compliance/unsubscribe-handler";
import { loadOrgSettings } from "@/server/agency";

const STATUS_FOR: Partial<Record<ReplyOutput["category"], string>> = {
  interested: "interested", meeting_request: "interested", more_info: "replied", not_interested: "not_interested",
  follow_up_later: "replied", unsubscribe: "suppressed", complaint: "suppressed", unknown: "replied",
};

async function findOutbound(admin: SupabaseClient, orgId: string, m: InboundMessage) {
  const sel = "id, org_id, campaign_id, campaign_recipient_id, business_id, contact_id, email_account_id, subject, body_text, to_email, conversation_id";
  if (m.inReplyTo) {
    const { data } = await admin.from("outbound_messages").select(sel).eq("org_id", orgId).eq("message_id_header", m.inReplyTo).maybeSingle();
    if (data) return { msg: data, by: "in_reply_to" as const };
  }
  for (const ref of [...m.references].reverse()) {
    const { data } = await admin.from("outbound_messages").select(sel).eq("org_id", orgId).eq("message_id_header", ref).maybeSingle();
    if (data) return { msg: data, by: "references" as const };
  }
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data } = await admin.from("outbound_messages").select(sel).eq("org_id", orgId).eq("to_email", m.from).gte("sent_at", since).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (data) return { msg: data, by: "sender" as const };
  return null;
}

/** Ingest one inbound message for a mailbox. Idempotent on Message-ID. */
export async function ingestInbound(orgId: string, accountId: string, m: InboundMessage) {
  const admin = createAdminClient();
  const { data: account } = await admin.from("email_accounts").select("email_address").eq("id", accountId).single();
  if (!account || m.from === account.email_address.toLowerCase()) return { skipped: "own_message" };

  if (m.isBounce) {
    const target = m.bouncedRecipient;
    if (!target) return { skipped: "bounce_without_recipient" };
    const { data: out } = await admin.from("outbound_messages").select("id").eq("org_id", orgId).eq("to_email", target).order("sent_at", { ascending: false }).limit(1).maybeSingle();
    if (out) await admin.from("outbound_messages").update({ status: "bounced" }).eq("id", out.id);
    await suppressAddress(orgId, target, "hard_bounce", "dsn", null);
    return { bounce: target };
  }

  const { data: dup } = await admin.from("replies").select("id").eq("org_id", orgId).eq("message_id_header", m.messageId).maybeSingle();
  if (dup) return { skipped: "duplicate" };

  const match = await findOutbound(admin, orgId, m);
  if (!match) return { skipped: "unmatched" }; // not related to outreach — leave the mailbox alone
  const out = match.msg;

  // Conversation per campaign recipient (or per outbound thread for ad-hoc messages).
  let conversationId = out.conversation_id as string | null;
  if (!conversationId && out.campaign_recipient_id) {
    const { data: existing } = await admin.from("conversations").select("id").eq("campaign_recipient_id", out.campaign_recipient_id).maybeSingle();
    conversationId = existing?.id ?? null;
  }
  if (!conversationId) {
    const { data: created } = await admin
      .from("conversations")
      .insert({ org_id: orgId, business_id: out.business_id, contact_id: out.contact_id, campaign_id: out.campaign_id, campaign_recipient_id: out.campaign_recipient_id, email_account_id: accountId, subject: out.subject, participant_email: m.from })
      .select("id")
      .single();
    conversationId = created!.id;
    await admin.from("outbound_messages").update({ conversation_id: conversationId }).eq("org_id", orgId).eq("campaign_recipient_id", out.campaign_recipient_id ?? "00000000-0000-0000-0000-000000000000");
    await admin.from("outbound_messages").update({ conversation_id: conversationId }).eq("id", out.id);
  }

  // Classify (AI with heuristic fallback). Auto-replies are classified locally.
  const { locale } = await loadOrgSettings(admin, orgId);
  let ai: ReplyOutput = heuristicReply(m.text, m.subject, locale);
  if (m.isAutoReply) ai = { ...ai, category: "out_of_office", confidence: 0.9, follow_up_in_days: ai.follow_up_in_days ?? 7, objects_to_contact: false };
  else {
    try {
      const res = await structured({
        task: "replies", orgId, system: replySystemPrompt(locale),
        user: replyUserPrompt({ originalSubject: out.subject, originalBody: out.body_text, reply: m.text }),
        schema: replySchema, schemaName: "reply_classification", mock: () => heuristicReply(m.text, m.subject, locale), maxOutputTokens: 600,
      });
      ai = res.data;
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
    }
  }

  const { data: reply, error } = await admin
    .from("replies")
    .insert({
      org_id: orgId, conversation_id: conversationId, email_account_id: accountId, outbound_message_id: out.id, from_email: m.from, from_name: m.fromName,
      to_email: m.to, subject: m.subject, body_text: m.text, message_id_header: m.messageId, in_reply_to: m.inReplyTo, references_headers: m.references,
      received_at: m.receivedAt.toISOString(), matched_by: match.by, ai_category: ai.category, ai_confidence: Math.max(0, Math.min(1, ai.confidence)),
      ai_summary: ai.summary.slice(0, 600), suggested_next_step: ai.suggested_next_step.slice(0, 600), is_auto_reply: m.isAutoReply || ai.category === "out_of_office",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { skipped: "duplicate" };
    throw error;
  }

  const human = ai.category !== "out_of_office";
  await admin.from("conversations").update({ latest_category: ai.category, needs_attention: human, last_message_at: m.receivedAt.toISOString(), status: "open" }).eq("id", conversationId);
  await admin.from("email_events").insert({ org_id: orgId, outbound_message_id: out.id, email_account_id: accountId, type: "replied", provider: "inbox", occurred_at: m.receivedAt.toISOString(), payload: { category: ai.category } });

  if (out.campaign_recipient_id) {
    if (human) {
      // Any human reply stops the sequence.
      await admin.from("campaign_recipients").update({ status: "replied", next_send_at: null, stop_reason: `reply:${ai.category}` }).eq("id", out.campaign_recipient_id).in("status", ["active", "pending", "completed"]);
    } else {
      // Out of office: postpone, don't stop.
      const until = new Date(Date.now() + (ai.follow_up_in_days ?? 7) * 86_400_000).toISOString();
      await admin.from("campaign_recipients").update({ next_send_at: until }).eq("id", out.campaign_recipient_id).eq("status", "active");
    }
  }

  if (ai.objects_to_contact || ai.category === "unsubscribe" || ai.category === "complaint") {
    await suppressAddress(orgId, m.from, ai.category === "complaint" ? "complaint" : ai.category === "unsubscribe" ? "unsubscribe" : "objection", "reply", null);
  }

  if (out.business_id && human) {
    const next = STATUS_FOR[ai.category];
    const { data: b } = await admin.from("businesses").select("lead_status").eq("id", out.business_id).single();
    const terminal = ["customer", "meeting_booked"];
    if (next && b && !terminal.includes(b.lead_status)) await admin.from("businesses").update({ lead_status: next }).eq("id", out.business_id);
    await admin.from("activities").insert({ org_id: orgId, business_id: out.business_id, contact_id: out.contact_id, type: "reply_received", data: { category: ai.category, reply_id: reply.id } });
    if (ai.category === "meeting_request" || ai.category === "interested" || ai.category === "follow_up_later") {
      const days = ai.category === "follow_up_later" ? ai.follow_up_in_days ?? 30 : 1;
      await admin.from("tasks").insert({
        org_id: orgId, business_id: out.business_id, contact_id: out.contact_id,
        title: ai.category === "meeting_request" ? (locale === "nl" ? "Afspraak inplannen" : "Schedule meeting") : ai.category === "interested" ? (locale === "nl" ? "Reageer op geïnteresseerde lead" : "Respond to interested lead") : (locale === "nl" ? "Opnieuw contact opnemen" : "Follow up again"),
        description: ai.suggested_next_step, due_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      });
    }
  }
  return { replyId: reply.id, category: ai.category, matchedBy: match.by };
}

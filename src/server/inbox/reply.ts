import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { env } from "@/server/env";
import { isSuppressed } from "@/server/compliance/evaluate";
import { providerFor, type EmailAccountRow } from "@/server/sending/accounts";
import { composeMessage } from "@/server/sending/compose";
import { structured } from "@/server/ai/client";
import { replyDraftSchema, replyDraftSystemPrompt } from "@/server/ai/prompts/reply";
import { wrapUntrusted } from "@/server/ai/sanitize";
import { loadAgencyProfile, loadOrgSettings } from "@/server/agency";

/** Send a reply written (and explicitly sent) by a user. Never automatic. */
export async function sendConversationReply(orgId: string, userId: string, conversationId: string, body: string) {
  const admin = createAdminClient();
  const { data: conv } = await admin.from("conversations").select("*").eq("id", conversationId).eq("org_id", orgId).single();
  if (!conv?.participant_email || !conv.email_account_id) return { error: "no_thread" as const };
  if (await isSuppressed(admin, orgId, conv.participant_email)) return { error: "suppressed" as const };
  const { data: last } = await admin.from("replies").select("message_id_header, references_headers, subject").eq("conversation_id", conversationId).order("received_at", { ascending: false }).limit(1).maybeSingle();
  const { data: account } = await admin.from("email_accounts").select("*").eq("id", conv.email_account_id).single<EmailAccountRow>();
  if (!account || account.status === "disconnected") return { error: "account_unavailable" as const };
  const { data: org } = await admin.from("organizations").select("legal_name, kvk_number, postal_address, privacy_policy_url, locale").eq("id", orgId).single();
  if (!org?.legal_name || !org.kvk_number || !org.postal_address) return { error: "sender_identity" as const };

  const msg = composeMessage({
    orgId, appUrl: env().APP_URL, from: { name: account.display_name, email: account.email_address }, to: conv.participant_email,
    subject: (last?.subject ?? conv.subject ?? "").replace(/^re:\s*/i, ""), body,
    identity: { legalName: org.legal_name, postalAddress: org.postal_address, kvkNumber: org.kvk_number, privacyUrl: org.privacy_policy_url, footerText: null, language: org.locale === "en" ? "en" : "nl" },
    thread: last ? { inReplyTo: last.message_id_header, references: [...(last.references_headers ?? []), last.message_id_header].slice(-10) } : null,
  });
  const provider = await providerFor(admin, account);
  const res = await provider.send(msg);
  const sentAt = new Date().toISOString();
  const { data: out } = await admin
    .from("outbound_messages")
    .insert({
      org_id: orgId, conversation_id: conversationId, campaign_id: conv.campaign_id, business_id: conv.business_id, contact_id: conv.contact_id,
      email_account_id: account.id, sequence_step: 0, to_email: conv.participant_email, from_email: account.email_address, subject: msg.subject,
      body_text: msg.text, message_id_header: res.messageIdHeader ?? msg.messageId, in_reply_to: msg.inReplyTo, provider_message_id: res.providerMessageId,
      status: "sent", sent_at: sentAt, sent_by: userId, is_mock: account.is_mock,
    })
    .select("id")
    .single();
  await admin.from("email_events").insert({ org_id: orgId, outbound_message_id: out?.id, email_account_id: account.id, type: "sent", provider: account.provider });
  await admin.from("conversations").update({ needs_attention: false, last_message_at: sentAt }).eq("id", conversationId);
  if (conv.business_id) await admin.from("activities").insert({ org_id: orgId, business_id: conv.business_id, actor_id: userId, type: "reply_sent", data: { conversation_id: conversationId } });
  return { ok: true as const };
}

/** AI-drafted reply for the user to edit; never sent automatically. */
export async function draftConversationReply(orgId: string, conversationId: string) {
  const admin = createAdminClient();
  const { data: conv } = await admin.from("conversations").select("business_id, subject").eq("id", conversationId).eq("org_id", orgId).single();
  const { data: last } = await admin.from("replies").select("body_text, from_name, ai_category, suggested_next_step").eq("conversation_id", conversationId).order("received_at", { ascending: false }).limit(1).maybeSingle();
  const [{ locale }, agency] = await Promise.all([loadOrgSettings(admin, orgId), loadAgencyProfile(admin, orgId)]);
  const nl = locale === "nl";
  const name = last?.from_name?.split(" ")[0];
  const res = await structured({
    task: "replies", orgId, system: replyDraftSystemPrompt(locale),
    user: `Agency: ${JSON.stringify({ name: agency?.agency_name, services: agency?.services, cta: agency?.call_to_action, sender: agency?.sender_name })}
Suggested next step: ${last?.suggested_next_step ?? ""}
Category: ${last?.ai_category ?? "unknown"}
Their message:
${wrapUntrusted("untrusted_email_content", last?.body_text ?? "", 3000)}`,
    schema: replyDraftSchema, schemaName: "reply_draft", maxOutputTokens: 500,
    mock: () => ({ body: nl ? `Beste ${name ?? "heer/mevrouw"},\n\nDank voor uw reactie. ${last?.ai_category === "meeting_request" || last?.ai_category === "interested" ? "Zullen we een kort gesprek inplannen? Past dinsdag of donderdag u?" : "Ik kom graag bij u terug met meer informatie."}\n\nMet vriendelijke groet,\n${agency?.sender_name ?? agency?.agency_name ?? ""}` : `Dear ${name ?? "Sir/Madam"},\n\nThank you for your reply. Shall we schedule a short call?\n\nKind regards,\n${agency?.sender_name ?? ""}` }),
  });
  void conv;
  return { body: res.data.body, isMock: res.isMock };
}

import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { verifyUnsubscribeToken } from "./unsubscribe";

/**
 * Process an opt-out: suppress the address, stop every active sequence for it,
 * record the event and update the CRM. Idempotent.
 */
export async function handleUnsubscribe(token: string, source: "link" | "one_click" | "reply" = "link") {
  const payload = verifyUnsubscribeToken(token);
  if (!payload) return { ok: false as const };
  return suppressAddress(payload.o, payload.e, "unsubscribe", source, payload.m ?? null);
}

export async function suppressAddress(orgId: string, email: string, reason: "unsubscribe" | "objection" | "complaint" | "hard_bounce", source: string, messageIdHeader: string | null = null) {
  const admin = createAdminClient();
  const address = email.toLowerCase();
  const { data: org } = await admin.from("organizations").select("id").eq("id", orgId).maybeSingle();
  if (!org) return { ok: false as const };
  await admin.from("suppression_records").upsert({ org_id: orgId, email: address, reason, source }, { onConflict: "org_id,email", ignoreDuplicates: true });
  const { data: stopped } = await admin
    .from("campaign_recipients")
    .update({ status: reason === "hard_bounce" ? "bounced" : "unsubscribed", next_send_at: null, stop_reason: reason })
    .eq("org_id", orgId)
    .eq("email", address)
    .in("status", ["pending", "active"])
    .select("id, business_id");
  let messageId: string | null = null;
  if (messageIdHeader) {
    const { data } = await admin.from("outbound_messages").select("id").eq("org_id", orgId).eq("message_id_header", messageIdHeader).maybeSingle();
    messageId = data?.id ?? null;
  }
  await admin.from("email_events").insert({ org_id: orgId, outbound_message_id: messageId, type: reason === "hard_bounce" ? "bounced_hard" : reason === "complaint" ? "complained" : "unsubscribed", provider: source, payload: { email: address } });
  await admin.from("contacts").update({ lead_status: "suppressed" }).eq("org_id", orgId).eq("email", address);
  for (const s of stopped ?? []) {
    await admin.from("activities").insert({ org_id: orgId, business_id: s.business_id, type: "unsubscribed", data: { reason, source } });
  }
  // Pending reviews for this address can no longer be sent.
  await admin.from("generated_emails").update({ compliance_status: "blocked" }).eq("org_id", orgId).eq("recipient_email", address);
  return { ok: true as const, stopped: stopped?.length ?? 0 };
}

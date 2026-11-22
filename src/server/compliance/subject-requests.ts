import "server-only";
import { createAdminClient } from "@/server/supabase/admin";

/** GDPR access request: everything this workspace holds about an address. */
export async function exportSubjectData(orgId: string, email: string) {
  const admin = createAdminClient();
  const e = email.toLowerCase();
  const [contacts, permissions, suppression, messages, replies, emails] = await Promise.all([
    admin.from("contacts").select("full_name, job_title, email, phone, source, created_at, contact_sources(provider, source_url, retrieved_at)").eq("org_id", orgId).eq("email", e),
    admin.from("email_permissions").select("basis, purpose, source, evidence, obtained_at, expires_at, revoked_at").eq("org_id", orgId).eq("email", e),
    admin.from("suppression_records").select("reason, source, created_at").eq("org_id", orgId).eq("email", e),
    admin.from("outbound_messages").select("subject, body_text, sent_at, status").eq("org_id", orgId).eq("to_email", e),
    admin.from("replies").select("subject, body_text, received_at").eq("org_id", orgId).eq("from_email", e),
    admin.from("generated_emails").select("subject, body, created_at, review_status").eq("org_id", orgId).eq("recipient_email", e),
  ]);
  return {
    email: e, exported_at: new Date().toISOString(),
    contacts: contacts.data ?? [], permissions: permissions.data ?? [], suppression: suppression.data ?? [],
    messages_sent: messages.data ?? [], replies_received: replies.data ?? [], drafts: emails.data ?? [],
  };
}

/**
 * GDPR erasure: delete personal data for an address. A minimal suppression
 * record is kept so the person is never contacted again (legitimate interest
 * in honouring the request); message bodies are redacted.
 */
export async function deleteSubjectData(orgId: string, email: string) {
  const admin = createAdminClient();
  const e = email.toLowerCase();
  await admin.from("campaign_recipients").update({ status: "cancelled", next_send_at: null, stop_reason: "erasure_request" }).eq("org_id", orgId).eq("email", e).in("status", ["pending", "active"]);
  await admin.from("generated_emails").update({ recipient_email: null, contact_id: null, compliance_status: "blocked" }).eq("org_id", orgId).eq("recipient_email", e);
  await admin.from("outbound_messages").update({ body_text: "[verwijderd op verzoek]", subject: "[verwijderd]" }).eq("org_id", orgId).eq("to_email", e);
  await admin.from("replies").update({ body_text: "[verwijderd op verzoek]", from_name: null, ai_summary: null }).eq("org_id", orgId).eq("from_email", e);
  await admin.from("email_permissions").delete().eq("org_id", orgId).eq("email", e);
  await admin.from("contacts").delete().eq("org_id", orgId).eq("email", e);
  await admin.from("suppression_records").upsert({ org_id: orgId, email: e, reason: "deletion_request", source: "data_subject_request" }, { onConflict: "org_id,email" });
  return { ok: true };
}

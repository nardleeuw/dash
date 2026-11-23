import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { consumeCredits } from "@/server/usage";
import { getHunter } from "@/server/providers/registry-hunter";
import { ProviderError } from "@/server/providers/types";
import { classifyEmail } from "@/server/discovery/normalize";

const VERIFICATION_MAP: Record<string, string> = { valid: "valid", invalid: "invalid", accept_all: "accept_all", webmail: "webmail", disposable: "disposable", unknown: "unknown" };

/**
 * Find business email addresses for a company's domain via Hunter. Found
 * addresses are stored with their sources; finding an address does NOT make
 * it eligible for outreach — see the compliance gate.
 */
export async function findContactsWithHunter(orgId: string, userId: string | null, businessId: string) {
  const admin = createAdminClient();
  const hunter = getHunter();
  if (!hunter) return { error: "not_configured" as const };
  const { data: b } = await admin.from("businesses").select("id, domain, is_mock").eq("id", businessId).eq("org_id", orgId).single();
  if (!b?.domain) return { error: "no_domain" as const };

  await consumeCredits({ orgId, kind: "enrichment", userId, referenceType: "hunter", referenceId: businessId, idempotencyKey: `hunter:${businessId}:${new Date().toISOString().slice(0, 10)}` });
  let result: Awaited<ReturnType<typeof hunter.client.domainSearch>>;
  try {
    result = await hunter.client.domainSearch(b.domain, orgId, 10);
  } catch (err) {
    if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) return { error: "provider_auth" as const };
    if (err instanceof ProviderError && err.status === 429) return { error: "provider_limit" as const };
    throw err;
  }
  if (!result) return { added: 0, total: 0 };

  let added = 0;
  for (const e of result.emails) {
    const email = e.value.toLowerCase();
    const { data: existing } = await admin.from("contacts").select("id").eq("org_id", orgId).eq("email", email).maybeSingle();
    let contactId = existing?.id as string | undefined;
    const type = e.type === "generic" ? "generic" : classifyEmail(email) === "generic" ? "generic" : "personal";
    if (!contactId) {
      const fullName = [e.first_name, e.last_name].filter(Boolean).join(" ") || null;
      const { data: c, error } = await admin
        .from("contacts")
        .insert({
          org_id: orgId, business_id: businessId, email, first_name: e.first_name, last_name: e.last_name, full_name: fullName,
          job_title: e.position, department: e.department, linkedin_url: e.linkedin ?? null,
          email_type: type, recipient_category: type === "generic" ? "legal_entity_generic" : "legal_entity_personal",
          email_verification: VERIFICATION_MAP[e.verification?.status ?? "unknown"] ?? "unknown", email_verification_score: e.confidence,
          email_verified_at: e.verification?.date ?? null, source: hunter.isMock ? "mock" : "hunter", is_mock: hunter.isMock || b.is_mock,
        })
        .select("id")
        .single();
      if (error || !c) continue;
      contactId = c.id;
      added++;
    }
    const sources = e.sources.length ? e.sources.slice(0, 5) : [null];
    await admin.from("contact_sources").insert(
      sources.map((s) => ({
        org_id: orgId, contact_id: contactId!, provider: hunter.isMock ? "mock" : "hunter", source_url: s?.uri ?? null, confidence: e.confidence,
        source_detail: s ? { extracted_on: s.extracted_on, last_seen_on: s.last_seen_on, still_on_page: s.still_on_page } : null,
      })),
    );
  }
  await admin.from("activities").insert({ org_id: orgId, business_id: businessId, actor_id: userId, type: "contacts_found", data: { provider: "hunter", added } });
  return { added, total: result.emails.length };
}

export async function verifyContactEmail(orgId: string, userId: string | null, contactId: string) {
  const admin = createAdminClient();
  const hunter = getHunter();
  if (!hunter) return { error: "not_configured" as const };
  const { data: c } = await admin.from("contacts").select("id, email").eq("id", contactId).eq("org_id", orgId).single();
  if (!c?.email) return { error: "no_email" as const };
  await consumeCredits({ orgId, kind: "enrichment", userId, referenceType: "verify", referenceId: contactId, idempotencyKey: `verify:${contactId}:${new Date().toISOString().slice(0, 10)}` });
  const v = await hunter.client.verify(c.email, orgId);
  if (!v) return { error: "provider" as const };
  await admin.from("contacts").update({ email_verification: VERIFICATION_MAP[v.status] ?? "unknown", email_verification_score: v.score, email_verified_at: new Date().toISOString() }).eq("id", contactId);
  if (v.status === "invalid") {
    await admin.from("suppression_records").upsert({ org_id: orgId, email: c.email, reason: "invalid_address", source: "hunter_verification" }, { onConflict: "org_id,email", ignoreDuplicates: true });
  }
  return { status: v.status };
}

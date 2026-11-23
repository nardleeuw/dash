import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { consumeCredits } from "@/server/usage";
import { getHunter } from "@/server/providers/registry-hunter";

const VERIFICATION_MAP: Record<string, string> = { valid: "valid", invalid: "invalid", accept_all: "accept_all", webmail: "webmail", disposable: "disposable", unknown: "unknown" };

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

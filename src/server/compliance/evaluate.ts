import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/server/supabase/admin";
import { checkEligibility, readComplianceSettings, type EligibilityResult, type Permission } from "./eligibility";

export type SenderContext = { senderIdentityComplete: boolean; privacyNoticeConfigured: boolean; settings: ReturnType<typeof readComplianceSettings> };

export async function loadSenderContext(admin: SupabaseClient, orgId: string): Promise<SenderContext> {
  const [{ data: org }, { count: notices }] = await Promise.all([
    admin.from("organizations").select("legal_name, kvk_number, postal_address, privacy_policy_url, settings").eq("id", orgId).single(),
    admin.from("privacy_notices").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("is_active", true),
  ]);
  return {
    senderIdentityComplete: Boolean(org?.legal_name && org?.kvk_number && org?.postal_address),
    privacyNoticeConfigured: Boolean((notices ?? 0) > 0 || org?.privacy_policy_url),
    settings: readComplianceSettings(org?.settings as Record<string, unknown>),
  };
}

export async function isSuppressed(admin: SupabaseClient, orgId: string, email: string): Promise<{ reason: string } | null> {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const { data } = await admin
    .from("suppression_records")
    .select("reason, email, domain")
    .eq("org_id", orgId)
    .or(`email.eq.${email.toLowerCase()},and(email.is.null,domain.eq.${domain})`)
    .limit(1);
  return data?.[0] ? { reason: data[0].reason } : null;
}

/** Evaluate one recipient email address for a business. */
export async function evaluateRecipient(
  admin: SupabaseClient,
  orgId: string,
  args: { email: string | null; businessId: string; isMockContent: boolean; sender?: SenderContext; sendTime?: { reviewApproved: boolean; factCheckPassed: boolean; accountIsMock: boolean } },
): Promise<EligibilityResult> {
  const sender = args.sender ?? (await loadSenderContext(admin, orgId));
  const email = args.email?.toLowerCase() ?? null;
  const [{ data: b }, contactRes, permRes, suppression] = await Promise.all([
    admin.from("businesses").select("kvk_non_mailing").eq("id", args.businessId).single(),
    email ? admin.from("contacts").select("recipient_category, email_verification").eq("org_id", orgId).eq("email", email).maybeSingle() : Promise.resolve({ data: null }),
    email ? admin.from("email_permissions").select("basis, email, obtained_at, expires_at, revoked_at, justification").eq("org_id", orgId).eq("email", email) : Promise.resolve({ data: [] }),
    email ? isSuppressed(admin, orgId, email) : Promise.resolve(null),
  ]);
  const contact = contactRes.data as { recipient_category: string; email_verification: string } | null;
  return checkEligibility({
    email,
    recipientCategory: contact?.recipient_category ?? "unknown",
    emailVerification: contact?.email_verification ?? "unknown",
    suppression,
    kvkNonMailing: Boolean(b?.kvk_non_mailing),
    permissions: (permRes.data ?? []) as Permission[],
    settings: sender.settings,
    senderIdentityComplete: sender.senderIdentityComplete,
    privacyNoticeConfigured: sender.privacyNoticeConfigured,
    isMockContent: args.isMockContent,
    sendTime: args.sendTime,
  });
}

/** Re-evaluate and store the compliance status of a generated email. */
export async function evaluateEmailCompliance(orgId: string, emailId: string, sender?: SenderContext) {
  const admin = createAdminClient();
  const { data: e } = await admin.from("generated_emails").select("business_id, recipient_email, is_mock").eq("id", emailId).eq("org_id", orgId).single();
  if (!e) return null;
  const res = await evaluateRecipient(admin, orgId, { email: e.recipient_email, businessId: e.business_id, isMockContent: e.is_mock, sender });
  await admin.from("generated_emails").update({ compliance_status: res.eligible ? "eligible" : "blocked", compliance_reasons: res.reasons }).eq("id", emailId);
  return res;
}

/** Re-evaluate every generated email of a workspace (e.g. after a permission or setting change). */
export async function reevaluateOrganization(orgId: string) {
  const admin = createAdminClient();
  const sender = await loadSenderContext(admin, orgId);
  const { data } = await admin.from("generated_emails").select("id").eq("org_id", orgId).eq("generation_status", "completed").limit(5000);
  for (const r of data ?? []) await evaluateEmailCompliance(orgId, r.id, sender);
  return { evaluated: data?.length ?? 0 };
}

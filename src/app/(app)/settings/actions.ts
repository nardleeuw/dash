"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { requireRole, requireUser } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { createAdminClient } from "@/server/supabase/admin";
import { fail, ok, safeAction, type ActionResult } from "@/server/actions";
import { env } from "@/server/env";
import { reevaluateOrganization, evaluateEmailCompliance } from "@/server/compliance/evaluate";
import { suppressAddress } from "@/server/compliance/unsubscribe-handler";
import { exportSubjectData, deleteSubjectData } from "@/server/compliance/subject-requests";
import { postalAddressComplete } from "@/server/compliance/identity";

const uuid = z.string().uuid();
const opt = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

export async function updateOrganizationAction(input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    const p = z.object({
      name: z.string().trim().min(1).max(120),
      legal_name: opt(200),
      kvk_number: z.string().trim().regex(/^\d{8}$/).optional().nullable().or(z.literal("")).transform((v) => v || null),
      postal_address: opt(300).refine((v) => !v || postalAddressComplete(v), { message: "address_incomplete" }),
      privacy_policy_url: z.string().trim().url().max(300).optional().nullable().or(z.literal("")).transform((v) => v || null),
      locale: z.enum(["nl", "en"]),
    }).parse(input);
    const supabase = await createClient();
    const { error } = await supabase.from("organizations").update(p).eq("id", ws.org.id);
    if (error) throw error;
    after(() => reevaluateOrganization(ws.org.id).catch(() => undefined));
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function updateComplianceRulesAction(input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    const p = z.object({
      accepted_bases: z.array(z.enum(["consent", "existing_customer", "other_statutory_exception"])).min(1),
      require_verified_email: z.boolean(),
    }).parse(input);
    const supabase = await createClient();
    const { data: org } = await supabase.from("organizations").select("settings").eq("id", ws.org.id).single();
    const settings = { ...(org?.settings ?? {}), compliance: p };
    await supabase.from("organizations").update({ settings }).eq("id", ws.org.id);
    after(() => reevaluateOrganization(ws.org.id).catch(() => undefined));
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function savePrivacyNoticeAction(input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    const p = z.object({ language: z.enum(["nl", "en"]), email_footer: z.string().trim().min(20).max(1000), url: z.string().trim().url().max(300).optional().or(z.literal("")) }).parse(input);
    const supabase = await createClient();
    const { data: last } = await supabase.from("privacy_notices").select("version").eq("org_id", ws.org.id).eq("language", p.language).order("version", { ascending: false }).limit(1).maybeSingle();
    await supabase.from("privacy_notices").update({ is_active: false }).eq("org_id", ws.org.id).eq("language", p.language);
    const { error } = await supabase.from("privacy_notices").insert({ org_id: ws.org.id, language: p.language, version: (last?.version ?? 0) + 1, email_footer: p.email_footer, url: p.url || null, created_by: ws.user.id });
    if (error) throw error;
    after(() => reevaluateOrganization(ws.org.id).catch(() => undefined));
    revalidatePath("/settings");
    return ok(null);
  });
}

async function reevaluateAddress(orgId: string, email: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("generated_emails").select("id").eq("org_id", orgId).eq("recipient_email", email.toLowerCase()).eq("generation_status", "completed");
  for (const r of data ?? []) await evaluateEmailCompliance(orgId, r.id);
}

export async function addPermissionAction(formData: FormData): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("manager");
    const p = z.object({
      email: z.string().trim().toLowerCase().email(),
      basis: z.enum(["consent", "existing_customer", "other_statutory_exception"]),
      recipient_category: z.enum(["natural_person", "sole_trader", "legal_entity_personal", "legal_entity_generic", "unknown"]),
      purpose: z.string().trim().min(3).max(300),
      source: z.string().trim().min(3).max(300),
      evidence: z.string().trim().min(3).max(1000),
      evidence_url: z.string().trim().url().max(500).optional().or(z.literal("")),
      obtained_at: z.string().date(),
      expires_at: z.string().date().optional().or(z.literal("")),
      justification: z.string().trim().max(2000).optional(),
    }).parse(Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")));
    if (p.basis === "other_statutory_exception" && (p.justification ?? "").length < 20) return fail("validation", { justification: ["min 20"] });
    const supabase = await createClient();
    let evidencePath: string | null = null;
    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > 10 * 1024 * 1024) return fail("validation", { file: ["max 10MB"] });
      const allowed = ["application/pdf", "image/png", "image/jpeg", "text/plain", "message/rfc822"];
      if (!allowed.includes(file.type)) return fail("validation", { file: ["type"] });
      const ext = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
      evidencePath = `${ws.org.id}/${randomBytes(12).toString("hex")}.${ext}`;
      const { error: upErr } = await supabase.storage.from("compliance-evidence").upload(evidencePath, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
    }
    const { data: contact } = await supabase.from("contacts").select("id, business_id").eq("org_id", ws.org.id).eq("email", p.email).maybeSingle();
    const { error } = await supabase.from("email_permissions").insert({
      org_id: ws.org.id, email: p.email, contact_id: contact?.id ?? null, business_id: contact?.business_id ?? null, basis: p.basis,
      recipient_category: p.recipient_category, purpose: p.purpose, source: p.source, evidence: p.evidence, evidence_url: p.evidence_url || null,
      evidence_file_path: evidencePath, obtained_at: new Date(p.obtained_at).toISOString(), expires_at: p.expires_at ? new Date(p.expires_at).toISOString() : null,
      justification: p.justification || null, recorded_by: ws.user.id,
    });
    if (error) throw error;
    if (contact) await supabase.from("contacts").update({ recipient_category: p.recipient_category }).eq("id", contact.id);
    await reevaluateAddress(ws.org.id, p.email);
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function revokePermissionAction(id: unknown, reason: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("manager");
    const pid = uuid.parse(id);
    const r = z.string().trim().max(300).parse(reason ?? "");
    const supabase = await createClient();
    const { data } = await supabase.from("email_permissions").update({ revoked_at: new Date().toISOString(), revoked_reason: r || null }).eq("id", pid).eq("org_id", ws.org.id).select("email").single();
    if (data) await reevaluateAddress(ws.org.id, data.email);
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function addSuppressionAction(value: unknown, reason: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const v = z.string().trim().toLowerCase().min(3).max(254).parse(value);
    const r = z.enum(["manual", "objection", "unsubscribe", "complaint"]).parse(reason ?? "manual");
    if (v.includes("@")) {
      z.string().email().parse(v);
      await suppressAddress(ws.org.id, v, r === "manual" ? "objection" : r, `manual:${ws.user.id}`);
      const supabase = await createClient();
      await supabase.from("suppression_records").update({ reason: r }).eq("org_id", ws.org.id).eq("email", v);
    } else {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return fail("validation");
      const supabase = await createClient();
      const { error } = await supabase.from("suppression_records").insert({ org_id: ws.org.id, domain: v, reason: r, source: "manual", created_by: ws.user.id });
      if (error && error.code !== "23505") throw error;
      after(() => reevaluateOrganization(ws.org.id).catch(() => undefined));
    }
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function removeSuppressionAction(id: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    const sid = uuid.parse(id);
    const supabase = await createClient();
    await supabase.from("suppression_records").delete().eq("id", sid).eq("org_id", ws.org.id);
    after(() => reevaluateOrganization(ws.org.id).catch(() => undefined));
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function createSubjectRequestAction(input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("manager");
    const p = z.object({ email: z.string().trim().toLowerCase().email(), type: z.enum(["access", "deletion", "objection", "rectification", "restriction"]), notes: z.string().trim().max(2000).optional() }).parse(input);
    const supabase = await createClient();
    const { error } = await supabase.from("data_subject_requests").insert({ org_id: ws.org.id, email: p.email, type: p.type, notes: p.notes || null, handled_by: ws.user.id });
    if (error) throw error;
    if (p.type === "objection" || p.type === "restriction") await suppressAddress(ws.org.id, p.email, "objection", "data_subject_request");
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function processSubjectRequestAction(id: unknown): Promise<ActionResult<{ export?: string }>> {
  return safeAction(async () => {
    const ws = await requireRole("manager");
    const rid = uuid.parse(id);
    const supabase = await createClient();
    const { data: req } = await supabase.from("data_subject_requests").select("id, email, type, status").eq("id", rid).eq("org_id", ws.org.id).single();
    if (!req) return fail("notFound");
    let exportJson: string | undefined;
    if (req.type === "access") exportJson = JSON.stringify(await exportSubjectData(ws.org.id, req.email), null, 2);
    if (req.type === "deletion") await deleteSubjectData(ws.org.id, req.email);
    if (req.type === "objection" || req.type === "restriction") await suppressAddress(ws.org.id, req.email, "objection", "data_subject_request");
    await supabase.from("data_subject_requests").update({ status: "completed", completed_at: new Date().toISOString(), handled_by: ws.user.id }).eq("id", rid);
    revalidatePath("/settings");
    return ok({ export: exportJson });
  });
}

export async function inviteMemberAction(input: unknown): Promise<ActionResult<{ link: string }>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    const p = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["admin", "manager", "sales_rep", "viewer"]) }).parse(input);
    const token = randomBytes(24).toString("base64url");
    const supabase = await createClient();
    const { error } = await supabase.from("organization_invitations").insert({ org_id: ws.org.id, email: p.email, role: p.role, token_hash: createHash("sha256").update(token).digest("hex"), invited_by: ws.user.id });
    if (error) throw error;
    revalidatePath("/settings");
    return ok({ link: `${env().APP_URL}/invite/${token}` });
  });
}

export async function revokeInvitationAction(id: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    const supabase = await createClient();
    await supabase.from("organization_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", uuid.parse(id)).eq("org_id", ws.org.id);
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function setMemberRoleAction(memberId: unknown, role: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    await requireRole("admin");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_member_role", { p_member_id: uuid.parse(memberId), p_role: z.enum(["owner", "admin", "manager", "sales_rep", "viewer"]).parse(role) });
    if (error) return fail(error.message.includes("owner") ? "owner_rule" : "forbidden");
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function removeMemberAction(memberId: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    await requireUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_member", { p_member_id: uuid.parse(memberId) });
    if (error) return fail(error.message.includes("owner") ? "owner_rule" : "forbidden");
    revalidatePath("/settings");
    return ok(null);
  });
}

export async function updateProfileAction(input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const user = await requireUser();
    const p = z.object({ full_name: z.string().trim().min(1).max(120), locale: z.enum(["nl", "en"]) }).parse(input);
    const supabase = await createClient();
    await supabase.from("users").update(p).eq("id", user.id);
    revalidatePath("/", "layout");
    return ok(null);
  });
}

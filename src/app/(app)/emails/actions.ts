"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { createAdminClient } from "@/server/supabase/admin";
import { fail, ok, safeAction, type ActionResult } from "@/server/actions";
import { createBatch, requeueEmails } from "@/server/emails/batch";
import { factCheckEmail } from "@/server/emails/fact-check";
import { loadAgencyProfile } from "@/server/agency";
import { leadIdsForFilter } from "@/server/leads/query";
import { evaluateEmailCompliance } from "@/server/compliance/evaluate";
import { rateLimit } from "@/server/rate-limit";

const uuid = z.string().uuid();
const uuids = z.array(uuid).min(1).max(1000);

export async function createBatchAction(input: unknown): Promise<ActionResult<{ batchId: string; queued: number; skipped: number }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    await rateLimit(`batch:${ws.org.id}`, 10);
    const p = z.object({
      scope: z.enum(["selection", "filter", "list"]),
      businessIds: z.array(uuid).max(1000).optional(),
      filter: z.record(z.string(), z.string().max(200)).optional(),
      listId: uuid.optional(),
      agencyProfileId: uuid,
      mode: z.enum(["missing_only", "regenerate_all"]),
      instructions: z.string().trim().max(800).optional(),
      research: z.boolean().optional(),
      findEmails: z.boolean().optional(),
    }).parse(input);
    const supabase = await createClient();
    const { data: profile } = await supabase.from("agency_profiles").select("id, client_id, language, services").eq("id", p.agencyProfileId).eq("org_id", ws.org.id).maybeSingle();
    if (!profile) return fail("forbidden");
    if (!(profile.services as unknown[])?.length) return fail("profile_incomplete");

    let ids: string[] = [];
    if (p.scope === "selection") ids = p.businessIds ?? [];
    else if (p.scope === "filter") ids = await leadIdsForFilter(supabase, ws.org.id, p.filter ?? {});
    else if (p.listId) {
      const { data } = await supabase.from("lead_list_members").select("business_id").eq("org_id", ws.org.id).eq("list_id", p.listId).limit(1000);
      ids = (data ?? []).map((r) => r.business_id);
    }
    // Only businesses of this workspace (defence in depth; RLS also applies).
    const { data: owned } = await supabase.from("businesses").select("id").eq("org_id", ws.org.id).in("id", ids.slice(0, 1000));
    const res = await createBatch({
      orgId: ws.org.id, userId: ws.user.id, businessIds: (owned ?? []).map((o) => o.id), agencyProfileId: profile.id, clientId: profile.client_id,
      source: p.scope, sourceRef: p.scope === "filter" ? { filter: p.filter } : p.scope === "list" ? { listId: p.listId } : {},
      mode: p.mode, language: profile.language as "nl" | "en", instructions: p.instructions || null,
      options: { research: p.research !== false, findEmails: p.findEmails !== false },
    });
    revalidatePath("/emails");
    return ok(res);
  });
}

async function sourceTextsFor(orgId: string, email: { business_id: string; personalization_evidence: unknown; opportunity: unknown }) {
  const admin = createAdminClient();
  const [{ data: b }, { data: analysis }, { data: opps }] = await Promise.all([
    admin.from("businesses").select("name, city, province, industry, legal_form, website_url").eq("id", email.business_id).single(),
    admin.from("website_analyses").select("research, signals").eq("org_id", orgId).eq("business_id", email.business_id).eq("status", "completed").order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("opportunities").select("title, description, evidence").eq("business_id", email.business_id).eq("status", "open"),
  ]);
  const research = (analysis?.research ?? {}) as { observations?: { text: string; quote: string }[]; hypotheses?: { text: string }[] };
  return {
    business: b,
    hypotheses: (research.hypotheses ?? []).map((h) => h.text),
    texts: [
      ...(research.observations ?? []).flatMap((o) => [o.text, o.quote]),
      ...(opps ?? []).flatMap((o) => [o.title, o.description, ...((o.evidence as { text: string; quote?: string }[]) ?? []).flatMap((e) => [e.text, e.quote ?? ""])]),
      JSON.stringify(b ?? {}), JSON.stringify(analysis?.signals ?? {}),
    ],
  };
}

export async function updateEmailAction(id: unknown, input: unknown): Promise<ActionResult<{ passed: boolean }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const emailId = uuid.parse(id);
    const p = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(8000), contactId: uuid.nullable().optional() }).parse(input);
    const supabase = await createClient();
    const { data: email } = await supabase.from("generated_emails").select("*").eq("id", emailId).eq("org_id", ws.org.id).single();
    if (!email) return fail("notFound");
    let recipient = email.recipient_email as string | null;
    if (p.contactId !== undefined) {
      if (p.contactId) {
        const { data: c } = await supabase.from("contacts").select("email").eq("id", p.contactId).eq("business_id", email.business_id).single();
        if (!c?.email) return fail("validation");
        recipient = c.email;
      } else recipient = null;
    }
    const agency = await loadAgencyProfile(createAdminClient(), ws.org.id, email.agency_profile_id);
    const src = await sourceTextsFor(ws.org.id, email);
    const check = factCheckEmail({
      subject: p.subject, body: p.body,
      evidence: ((email.personalization_evidence ?? []) as { claim: string; evidence: string; source: string }[]),
      sourceTexts: src.texts, hypotheses: src.hypotheses, companyName: src.business?.name ?? "",
      agencyWebsite: agency?.website ?? null,
      agencyTexts: [JSON.stringify(agency?.services ?? []), agency?.description ?? "", agency?.unique_selling_proposition ?? "", agency?.signature ?? ""],
      avoidPhrases: agency?.avoid_phrases ?? [], length: agency?.email_length ?? "short",
    });
    if (email.subject !== p.subject || email.body !== p.body) {
      await supabase.from("generated_email_revisions").select("id").limit(0); // RLS check only; history written by service role:
      await createAdminClient().from("generated_email_revisions").insert({ org_id: ws.org.id, generated_email_id: emailId, version: email.version, subject: email.subject, body: email.body, reason: "edited", created_by: ws.user.id });
    }
    const { error } = await supabase
      .from("generated_emails")
      .update({
        subject: p.subject, body: p.body, recipient_email: recipient, contact_id: p.contactId === undefined ? email.contact_id : p.contactId,
        edited_by: ws.user.id, edited_at: new Date().toISOString(), version: email.version + 1,
        review_status: "pending", approved_by: null, approved_at: null,
      })
      .eq("id", emailId)
      .eq("org_id", ws.org.id);
    if (error) throw error;
    // System-managed check results are written with the service role.
    await createAdminClient().from("generated_emails").update({ fact_check: { passed: check.passed, issues: check.issues, edited: true } }).eq("id", emailId);
    await evaluateEmailCompliance(ws.org.id, emailId);
    revalidatePath(`/emails/${emailId}`);
    return ok({ passed: check.passed });
  });
}

export async function applyAlternativeAction(id: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const emailId = uuid.parse(id);
    const supabase = await createClient();
    const { data: e } = await supabase.from("generated_emails").select("subject, body, alt_subject, alt_body").eq("id", emailId).eq("org_id", ws.org.id).single();
    if (!e?.alt_body) return fail("notFound");
    await supabase.from("generated_emails").update({ subject: e.alt_subject, body: e.alt_body, alt_subject: e.subject, alt_body: e.body, review_status: "pending", approved_by: null, approved_at: null }).eq("id", emailId);
    revalidatePath(`/emails/${emailId}`);
    return ok(null);
  });
}

export async function approveEmailsAction(ids: unknown): Promise<ActionResult<{ count: number }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const list = uuids.parse(ids);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("generated_emails")
      .update({ review_status: "approved", approved_by: ws.user.id, approved_at: new Date().toISOString(), rejected_reason: null })
      .eq("org_id", ws.org.id)
      .in("id", list)
      .eq("generation_status", "completed")
      .not("body", "is", null)
      .select("id");
    if (error) throw error;
    revalidatePath("/emails");
    return ok({ count: data?.length ?? 0 });
  });
}

export async function approveAllEligibleAction(batchId: unknown): Promise<ActionResult<{ count: number }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const b = uuid.nullable().parse(batchId ?? null);
    const supabase = await createClient();
    let q = supabase
      .from("generated_emails")
      .update({ review_status: "approved", approved_by: ws.user.id, approved_at: new Date().toISOString() })
      .eq("org_id", ws.org.id)
      .eq("generation_status", "completed")
      .eq("review_status", "pending")
      .eq("fact_check->>passed", "true")
      .not("recipient_email", "is", null);
    if (b) q = q.eq("batch_id", b);
    const { data, error } = await q.select("id");
    if (error) throw error;
    revalidatePath("/emails");
    return ok({ count: data?.length ?? 0 });
  });
}

export async function rejectEmailsAction(ids: unknown, reason: unknown): Promise<ActionResult<{ count: number }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const list = uuids.parse(ids);
    const r = z.string().trim().max(500).optional().parse(reason ?? undefined);
    const supabase = await createClient();
    const { data, error } = await supabase.from("generated_emails").update({ review_status: "rejected", rejected_reason: r ?? null, approved_by: null, approved_at: null }).eq("org_id", ws.org.id).in("id", list).select("id");
    if (error) throw error;
    revalidatePath("/emails");
    return ok({ count: data?.length ?? 0 });
  });
}

export async function regenerateEmailsAction(ids: unknown, instructions?: unknown): Promise<ActionResult<{ queued: number }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const list = uuids.parse(ids);
    const instr = z.string().trim().max(800).optional().parse(instructions || undefined);
    const res = await requeueEmails(ws.org.id, list, instr ?? null);
    revalidatePath("/emails");
    return ok(res);
  });
}

export async function regenerateFailedAction(batchId: unknown): Promise<ActionResult<{ queued: number }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const b = uuid.parse(batchId);
    const supabase = await createClient();
    const { data } = await supabase.from("generated_emails").select("id").eq("org_id", ws.org.id).eq("batch_id", b).eq("generation_status", "failed");
    if (!data?.length) return ok({ queued: 0 });
    const res = await requeueEmails(ws.org.id, data.map((d) => d.id));
    revalidatePath("/emails");
    return ok(res);
  });
}

const profileSchema = z.object({
  agency_name: z.string().trim().min(1).max(120),
  website: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  services: z.array(z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).optional().nullable() })).max(20),
  products: z.string().trim().max(1000).optional().nullable(),
  target_industries: z.array(z.string().max(40)).max(30),
  ideal_customer_profile: z.string().trim().max(1000).optional().nullable(),
  unique_selling_proposition: z.string().trim().max(600).optional().nullable(),
  tone_of_voice: z.string().trim().max(300).optional().nullable(),
  writing_style: z.string().trim().max(300).optional().nullable(),
  language: z.enum(["nl", "en"]),
  email_length: z.enum(["short", "medium", "long"]),
  call_to_action: z.string().trim().max(300).optional().nullable(),
  example_emails: z.array(z.string().max(4000)).max(5),
  avoid_phrases: z.array(z.string().trim().min(1).max(80)).max(50),
  sender_name: z.string().trim().max(120).optional().nullable(),
  sender_title: z.string().trim().max(120).optional().nullable(),
  signature: z.string().trim().max(1000).optional().nullable(),
});

export async function saveAgencyProfileAction(id: unknown, input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("manager");
    const profileId = uuid.parse(id);
    const p = profileSchema.parse(input);
    const supabase = await createClient();
    const { error } = await supabase.from("agency_profiles").update(p).eq("id", profileId).eq("org_id", ws.org.id);
    if (error) throw error;
    revalidatePath("/emails");
    return ok(null);
  });
}

"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { fail, ok, safeAction, type ActionResult } from "@/server/actions";
import { addRecipients, cancelCampaign, generateFollowUps, launchCampaign, pauseCampaign, resumeCampaign } from "@/server/sending/campaigns";

const uuid = z.string().uuid();
const settingsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email_account_id: uuid.nullable(),
  agency_profile_id: uuid.nullable(),
  follow_up_sequence_id: uuid.nullable(),
  client_id: uuid.nullable().optional(),
  timezone: z.string().max(60).default("Europe/Amsterdam"),
  send_days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  send_window_start: z.string().regex(/^\d{2}:\d{2}$/),
  send_window_end: z.string().regex(/^\d{2}:\d{2}$/),
  daily_limit: z.number().int().min(1).max(2000),
  starts_at: z.string().datetime().nullable().optional(),
}).refine((v) => v.send_window_start < v.send_window_end, { message: "window", path: ["send_window_end"] });

export async function createCampaignAction(name: unknown) {
  const ws = await requireRole("sales_rep");
  const n = z.string().trim().min(1).max(160).parse(name);
  const supabase = await createClient();
  const [{ data: account }, { data: profile }] = await Promise.all([
    supabase.from("email_accounts").select("id").eq("org_id", ws.org.id).eq("status", "active").order("created_at").limit(1).maybeSingle(),
    supabase.from("agency_profiles").select("id").eq("org_id", ws.org.id).is("client_id", null).maybeSingle(),
  ]);
  const { data, error } = await supabase.from("campaigns").insert({ org_id: ws.org.id, name: n, email_account_id: account?.id ?? null, agency_profile_id: profile?.id ?? null, created_by: ws.user.id }).select("id").single();
  if (error) throw error;
  redirect(`/campaigns/${data.id}`);
}

export async function updateCampaignAction(id: unknown, input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const campaignId = uuid.parse(id);
    const p = settingsSchema.parse(input);
    const supabase = await createClient();
    const { data: c } = await supabase.from("campaigns").select("status").eq("id", campaignId).eq("org_id", ws.org.id).single();
    if (!c || !["draft", "paused", "scheduled"].includes(c.status)) return fail("invalid_status");
    const { error } = await supabase.from("campaigns").update(p).eq("id", campaignId).eq("org_id", ws.org.id);
    if (error) throw error;
    revalidatePath(`/campaigns/${campaignId}`);
    return ok(null);
  });
}

export async function addRecipientsAction(id: unknown, input: unknown): Promise<ActionResult<{ added: number; skipped: number }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const campaignId = uuid.parse(id);
    const p = z.object({ source: z.enum(["approved", "batch", "list"]), batchId: uuid.optional(), listId: uuid.optional() }).parse(input);
    const supabase = await createClient();
    const { data: c } = await supabase.from("campaigns").select("agency_profile_id").eq("id", campaignId).eq("org_id", ws.org.id).single();
    if (!c) return fail("notFound");
    let q = supabase.from("generated_emails").select("id, business_id").eq("org_id", ws.org.id).eq("sequence_step", 0).eq("review_status", "approved").eq("generation_status", "completed").not("recipient_email", "is", null).limit(2000);
    if (c.agency_profile_id) q = q.eq("agency_profile_id", c.agency_profile_id);
    if (p.source === "batch" && p.batchId) q = q.eq("batch_id", p.batchId);
    const { data: emails } = await q;
    let ids = (emails ?? []).map((e) => e.id);
    if (p.source === "list" && p.listId) {
      const { data: members } = await supabase.from("lead_list_members").select("business_id").eq("list_id", p.listId).eq("org_id", ws.org.id);
      const allowed = new Set((members ?? []).map((m) => m.business_id));
      ids = (emails ?? []).filter((e) => allowed.has(e.business_id)).map((e) => e.id);
    }
    const res = await addRecipients(ws.org.id, campaignId, ids);
    revalidatePath(`/campaigns/${campaignId}`);
    return ok({ added: res.added, skipped: res.skipped });
  });
}

export async function campaignControlAction(id: unknown, action: unknown): Promise<ActionResult<Record<string, unknown>>> {
  return safeAction(async () => {
    const ws = await requireRole("manager");
    const campaignId = uuid.parse(id);
    const a = z.enum(["launch", "pause", "resume", "cancel"]).parse(action);
    const res =
      a === "launch" ? await launchCampaign(ws.org.id, campaignId)
      : a === "pause" ? await pauseCampaign(ws.org.id, campaignId)
      : a === "resume" ? await resumeCampaign(ws.org.id, campaignId)
      : await cancelCampaign(ws.org.id, campaignId);
    if ("error" in res && res.error) return fail(res.error);
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");
    return ok(res as Record<string, unknown>);
  });
}

export async function generateFollowUpsAction(id: unknown): Promise<ActionResult<{ queued: number }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const campaignId = uuid.parse(id);
    const res = await generateFollowUps(ws.org.id, campaignId, ws.user.id);
    if ("error" in res && res.error) return fail(res.error);
    revalidatePath(`/campaigns/${campaignId}`);
    return ok({ queued: res.queued ?? 0 });
  });
}

export async function saveSequenceAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const ws = await requireRole("manager");
    const p = z.object({
      id: uuid.optional(),
      name: z.string().trim().min(1).max(120),
      steps: z.array(z.object({ delay_days: z.number().int().min(1).max(60), instructions: z.string().trim().max(600).optional().nullable() })).min(1).max(5),
    }).parse(input);
    const steps = p.steps.map((s, i) => ({ step: i + 1, delay_days: s.delay_days, instructions: s.instructions || null }));
    const supabase = await createClient();
    if (p.id) {
      const { error } = await supabase.from("follow_up_sequences").update({ name: p.name, steps }).eq("id", p.id).eq("org_id", ws.org.id);
      if (error) throw error;
      revalidatePath("/campaigns");
      return ok({ id: p.id });
    }
    const { data, error } = await supabase.from("follow_up_sequences").insert({ org_id: ws.org.id, name: p.name, steps, created_by: ws.user.id }).select("id").single();
    if (error) throw error;
    revalidatePath("/campaigns");
    return ok({ id: data.id });
  });
}

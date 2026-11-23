"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { fail, ok, safeAction, type ActionResult } from "@/server/actions";
import { requestResearch, rescoreOrganization } from "@/server/research/run";
import { verifyContactEmail } from "@/server/research/contacts";
import { findBusinessEmails, type ContactSourceKey } from "@/server/contacts/finder";
import { CreditsExhaustedError } from "@/server/usage";
import { DEFAULT_WEIGHTS } from "@/server/scoring/score";
import { rateLimit } from "@/server/rate-limit";
import { dispatch } from "@/server/jobs/dispatch";

export async function startResearchAction(businessIds: unknown): Promise<ActionResult<{ queued: number; skipped: number }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const ids = z.array(z.string().uuid()).min(1).max(500).parse(businessIds);
    await rateLimit(`research:${ws.org.id}`, 20);
    const res = await requestResearch(ws.org.id, ws.user.id, ids);
    revalidatePath("/research");
    return ok(res);
  });
}

export async function findContactsAction(businessId: unknown): Promise<ActionResult<{ added: number; total: number; bySource: Record<ContactSourceKey, number> }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const id = z.string().uuid().parse(businessId);
    await rateLimit(`contacts:${ws.org.id}`, 30);
    try {
      const res = await findBusinessEmails(ws.org.id, ws.user.id, id);
      if ("error" in res) return fail(res.error === "not_found" ? "notFound" : res.error);
      revalidatePath(`/leads/${id}`);
      return ok({ added: res.added, total: res.total, bySource: res.bySource });
    } catch (err) {
      if (err instanceof CreditsExhaustedError) return fail(err.name === "PaymentRequiredError" ? "payment_required" : "credits");
      throw err;
    }
  });
}

export async function verifyEmailAction(contactId: unknown, businessId: unknown): Promise<ActionResult<{ status: string }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const id = z.string().uuid().parse(contactId);
    const b = z.string().uuid().parse(businessId);
    try {
      const res = await verifyContactEmail(ws.org.id, ws.user.id, id);
      if ("error" in res && res.error) return fail(res.error);
      revalidatePath(`/leads/${b}`);
      return ok({ status: res.status! });
    } catch (err) {
      if (err instanceof CreditsExhaustedError) return fail(err.name === "PaymentRequiredError" ? "payment_required" : "credits");
      throw err;
    }
  });
}

const weightsSchema = z.object(Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, z.number().int().min(0).max(100)])) as Record<keyof typeof DEFAULT_WEIGHTS, z.ZodNumber>);

export async function saveScoringAction(input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("manager");
    const parsed = z.object({ weights: weightsSchema, targetProvinces: z.array(z.string().max(40)).max(12) }).parse(input);
    const supabase = await createClient();
    const { data: org } = await supabase.from("organizations").select("settings").eq("id", ws.org.id).single();
    const settings = { ...(org?.settings ?? {}), scoring_weights: parsed.weights, target_provinces: parsed.targetProvinces };
    const { error } = await supabase.from("organizations").update({ settings }).eq("id", ws.org.id);
    if (error) throw error;
    after(() => rescoreOrganization(ws.org.id).catch((e) => console.error("[rescore]", e)));
    revalidatePath("/research");
    return ok(null);
  });
}

const BULK_CONTACTS_MAX = 50;

/** Look up email addresses for many businesses in the background (max 50 per call). */
export async function findContactsBulkAction(businessIds: unknown): Promise<ActionResult<{ queued: number; capped: boolean }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const ids = z.array(z.string().uuid()).min(1).max(1000).parse(businessIds);
    await rateLimit(`contacts-bulk:${ws.org.id}`, 10);
    const supabase = await createClient();
    const { data: owned } = await supabase.from("businesses").select("id").eq("org_id", ws.org.id).in("id", ids.slice(0, BULK_CONTACTS_MAX));
    const list = (owned ?? []).map((b) => b.id as string);
    if (list.length) await dispatch("contacts/bulk.requested", { orgId: ws.org.id, userId: ws.user.id, businessIds: list });
    return ok({ queued: list.length, capped: ids.length > BULK_CONTACTS_MAX });
  });
}

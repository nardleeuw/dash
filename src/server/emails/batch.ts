import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { inngest, inngestEnabled } from "@/server/jobs/client";
import { dispatch } from "@/server/jobs/dispatch";
import { generateEmailById } from "./generate";

export const MAX_BATCH = 1000;

export type CreateBatchInput = {
  orgId: string;
  userId: string | null;
  businessIds: string[];
  agencyProfileId: string;
  clientId?: string | null;
  source: "selection" | "list" | "filter" | "regenerate";
  sourceRef?: Record<string, unknown>;
  mode: "missing_only" | "regenerate_all";
  language: "nl" | "en";
  instructions?: string | null;
  name?: string | null;
  /** research: run AI website research first (default true); findEmails: look up addresses for businesses without one (default true). */
  options?: BatchOptions;
};

export type BatchOptions = {
  research?: boolean;
  findEmails?: boolean;
  /** Per-batch writing overrides (fall back to the sender profile). */
  personalization?: "subtle" | "balanced" | "strong";
  formality?: "formal" | "informal";
  email_length?: "short" | "medium" | "long";
};

/**
 * Create a generation batch: one generated_emails row per business (unique per
 * business × sender profile × step), then fan out generation jobs.
 */
export async function createBatch(input: CreateBatchInput) {
  const admin = createAdminClient();
  const ids = [...new Set(input.businessIds)].slice(0, MAX_BATCH);
  const { data: batch, error } = await admin
    .from("email_generation_batches")
    .insert({
      org_id: input.orgId, agency_profile_id: input.agencyProfileId, client_id: input.clientId ?? null, name: input.name ?? null,
      source: input.source, source_ref: input.sourceRef ?? {}, mode: input.mode, language: input.language,
      instructions: input.instructions ?? null, created_by: input.userId, status: "queued",
      options: {
        research: input.options?.research !== false, findEmails: input.options?.findEmails !== false,
        ...(input.options?.personalization ? { personalization: input.options.personalization } : {}),
        ...(input.options?.formality ? { formality: input.options.formality } : {}),
        ...(input.options?.email_length ? { email_length: input.options.email_length } : {}),
      },
    })
    .select("id")
    .single();
  if (error) throw error;

  let queued = 0;
  let skipped = 0;
  const extra = input.instructions ? { instructions: input.instructions } : null;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data: existing } = await admin
      .from("generated_emails")
      .select("id, business_id, generation_status, review_status")
      .eq("org_id", input.orgId)
      .eq("agency_profile_id", input.agencyProfileId)
      .eq("sequence_step", 0)
      .is("campaign_id", null)
      .in("business_id", chunk);
    const byBusiness = new Map((existing ?? []).map((e) => [e.business_id, e]));
    const requeue: string[] = [];
    const inserts: Record<string, unknown>[] = [];
    for (const businessId of chunk) {
      const e = byBusiness.get(businessId);
      if (!e) inserts.push({ org_id: input.orgId, batch_id: batch.id, business_id: businessId, agency_profile_id: input.agencyProfileId, language: input.language, generation_status: "queued", opportunity: extra });
      else if (input.mode === "regenerate_all" || e.generation_status === "failed") requeue.push(e.id);
      else skipped++;
    }
    if (inserts.length) {
      const { error: insErr } = await admin.from("generated_emails").insert(inserts);
      if (insErr) throw insErr;
      queued += inserts.length;
    }
    if (requeue.length) {
      await admin.from("generated_emails").update({ batch_id: batch.id, generation_status: "queued", review_status: "pending", error: null, attempts: 0, opportunity: extra }).in("id", requeue);
      queued += requeue.length;
    }
  }
  await admin.from("email_generation_batches").update({ total: queued, status: queued ? "running" : "completed", completed_at: queued ? null : new Date().toISOString() }).eq("id", batch.id);
  if (queued) await dispatch("emails/batch.created", { orgId: input.orgId, userId: input.userId, batchId: batch.id });
  return { batchId: batch.id as string, queued, skipped };
}

/** Fan out: one job per email (Inngest), or a small in-process pool. */
export async function planBatch({ orgId, batchId }: { orgId: string; batchId: string }) {
  const admin = createAdminClient();
  const { data: rows } = await admin.from("generated_emails").select("id").eq("org_id", orgId).eq("batch_id", batchId).eq("generation_status", "queued");
  const ids = (rows ?? []).map((r) => r.id as string);
  if (inngestEnabled()) {
    for (let i = 0; i < ids.length; i += 100) {
      await inngest.send(ids.slice(i, i + 100).map((emailId) => ({ name: "emails/generate.requested", data: { orgId, emailId } })));
    }
    return { dispatched: ids.length };
  }
  await runPool(ids, 3, async (id) => {
    try {
      await generateEmailById(orgId, id);
    } catch (err) {
      console.error("[emails] generation failed", id, (err as Error).message);
    }
  });
  await finalizeBatch(orgId, batchId);
  return { processed: ids.length };
}

export async function finalizeBatch(orgId: string, batchId: string) {
  const admin = createAdminClient();
  const { count } = await admin.from("generated_emails").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("batch_id", batchId).in("generation_status", ["queued", "researching", "generating"]);
  if ((count ?? 0) === 0) await admin.from("email_generation_batches").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", batchId).neq("status", "cancelled");
}

/** Re-queue specific emails (regenerate selected / failed). */
export async function requeueEmails(orgId: string, emailIds: string[], instructions?: string | null) {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("generated_emails")
    .update({ generation_status: "queued", review_status: "pending", error: null, attempts: 0, ...(instructions ? { opportunity: { instructions } } : {}) })
    .eq("org_id", orgId)
    .in("id", emailIds)
    .neq("generation_status", "generating")
    .select("id");
  for (const r of rows ?? []) await dispatch("emails/generate.requested", { orgId, emailId: r.id });
  return { queued: rows?.length ?? 0 };
}

async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

/**
 * Safety net for in-process generation (no Inngest): one serverless call may
 * only run for a few minutes, so large batches can leave emails "queued" or
 * stuck. Called from the 5-minute cron: picks up stale emails and continues
 * within a time budget.
 */
export async function resumeStaleGeneration(budgetMs = 240_000) {
  if (inngestEnabled()) return { resumed: 0 };
  const admin = createAdminClient();
  const started = Date.now();
  const queuedBefore = new Date(Date.now() - 3 * 60_000).toISOString();
  const stuckBefore = new Date(Date.now() - 12 * 60_000).toISOString();
  const { data: rows } = await admin
    .from("generated_emails")
    .select("id, org_id, batch_id, generation_status, updated_at")
    .or(`and(generation_status.eq.queued,updated_at.lt.${queuedBefore}),and(generation_status.in.(researching,generating),updated_at.lt.${stuckBefore})`)
    .lt("attempts", 3)
    .order("updated_at", { ascending: true })
    .limit(30);
  let resumed = 0;
  const batches = new Map<string, string>();
  await runPool(rows ?? [], 3, async (r) => {
    if (Date.now() - started > budgetMs) return;
    if (r.generation_status !== "queued") await admin.from("generated_emails").update({ generation_status: "queued" }).eq("id", r.id);
    try {
      await generateEmailById(r.org_id, r.id);
      resumed++;
    } catch (err) {
      console.error("[emails] resume failed", r.id, (err as Error).message);
    }
    if (r.batch_id) batches.set(r.batch_id, r.org_id);
  });
  for (const [batchId, orgId] of batches) await finalizeBatch(orgId, batchId);
  return { resumed };
}

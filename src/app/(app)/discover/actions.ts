"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { createAdminClient } from "@/server/supabase/admin";
import { runDiscovery, type SearchResponse } from "@/server/discovery/search";
import { importGroup, type ImportOutcome } from "@/server/discovery/import";
import { dispatch } from "@/server/jobs/dispatch";
import { CreditsExhaustedError, getCreditStatus } from "@/server/usage";
import { fail, ok, safeAction, type ActionResult } from "@/server/actions";
import { getLocale } from "@/i18n/server";
import { rateLimit } from "@/server/rate-limit";
import { cursorsSchema, importGroupsSchema, searchFiltersSchema } from "@/lib/discovery-schema";

export async function searchAction(filters: unknown, cursors: unknown): Promise<ActionResult<Omit<SearchResponse, "merged"> & { existing: Record<string, string> }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    await rateLimit(`search:${ws.org.id}`, 60);
    const f = searchFiltersSchema.parse(filters);
    const c = cursorsSchema.parse(cursors);
    try {
      const res = await runDiscovery(ws.org.id, ws.user.id, { ...f, language: await getLocale(), cursors: c });
      // Mark results already present in the lead database.
      const supabase = await createClient();
      const ids = res.merged.flatMap((m) => m.sources);
      const placeIds = ids.filter((s) => s.provider === "google_places").map((s) => s.externalId);
      const osmIds = ids.filter((s) => s.provider === "osm").map((s) => s.externalId);
      const kvkNumbers = ids.filter((s) => s.kvkNumber).map((s) => s.kvkNumber!);
      const existing: Record<string, string> = {};
      if (placeIds.length) {
        const { data } = await supabase.from("business_locations").select("business_id, google_place_id").eq("org_id", ws.org.id).in("google_place_id", placeIds);
        data?.forEach((r) => (existing[`google_places:${r.google_place_id}`] = r.business_id));
      }
      if (osmIds.length) {
        const { data } = await supabase.from("business_locations").select("business_id, osm_id").eq("org_id", ws.org.id).in("osm_id", osmIds);
        data?.forEach((r) => (existing[`osm:${r.osm_id}`] = r.business_id));
      }
      if (kvkNumbers.length) {
        const { data } = await supabase.from("businesses").select("id, kvk_number").eq("org_id", ws.org.id).in("kvk_number", [...new Set(kvkNumbers)]);
        data?.forEach((r) => (existing[`kvk:${r.kvk_number}`] = r.id));
      }
      return ok({ pages: res.pages, errors: res.errors, existing });
    } catch (err) {
      if (err instanceof CreditsExhaustedError) return fail(err.name === "PaymentRequiredError" ? "payment_required" : err.name === "SpendCapReachedError" ? "spend_cap" : "credits");
      throw err;
    }
  });
}

const SYNC_IMPORT_LIMIT = 10;

type ImportResult = { outcomes?: ImportOutcome[]; queued?: number };

export async function importAction(groups: unknown, listId: unknown): Promise<ActionResult<ImportResult>> {
  return safeAction<ImportResult>(async () => {
    const ws = await requireRole("sales_rep");
    const parsed = importGroupsSchema.parse(groups);
    const list = z.string().uuid().nullable().optional().parse(listId ?? null);
    if (list) {
      const supabase = await createClient();
      const { data } = await supabase.from("lead_lists").select("id").eq("id", list).eq("org_id", ws.org.id).maybeSingle();
      if (!data) return fail("forbidden");
    }
    // Never start an import that silently stops halfway: check the remaining allowance first.
    const enrichment = (await getCreditStatus(ws.org.id)).find((c) => c.kind === "enrichment");
    if (enrichment && enrichment.allowance - enrichment.used < parsed.length) {
      return fail("import_over_credits", { remaining: [String(Math.max(0, enrichment.allowance - enrichment.used))] });
    }
    if (parsed.length > SYNC_IMPORT_LIMIT) {
      await dispatch("discovery/import.requested", { orgId: ws.org.id, userId: ws.user.id, groups: parsed, listId: list ?? null });
      return ok({ queued: parsed.length });
    }
    try {
      const outcomes: ImportOutcome[] = [];
      for (const g of parsed) outcomes.push(await importGroup(ws.org.id, ws.user.id, g));
      if (list) {
        const rows = outcomes.filter((o) => o.businessId).map((o) => ({ org_id: ws.org.id, list_id: list, business_id: o.businessId!, added_by: ws.user.id }));
        if (rows.length) await createAdminClient().from("lead_list_members").upsert(rows, { onConflict: "list_id,business_id", ignoreDuplicates: true });
      }
      revalidatePath("/leads");
      return ok({ outcomes });
    } catch (err) {
      if (err instanceof CreditsExhaustedError) return fail(err.name === "PaymentRequiredError" ? "payment_required" : err.name === "SpendCapReachedError" ? "spend_cap" : "credits");
      throw err;
    }
  });
}

export async function saveSearchAction(name: unknown, filters: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const n = z.string().trim().min(1).max(120).parse(name);
    const f = searchFiltersSchema.parse(filters);
    const supabase = await createClient();
    const { data, error } = await supabase.from("saved_searches").insert({ org_id: ws.org.id, name: n, filters: f, created_by: ws.user.id }).select("id").single();
    if (error) throw error;
    revalidatePath("/discover");
    return ok({ id: data.id });
  });
}

export async function deleteSavedSearchAction(id: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const sid = z.string().uuid().parse(id);
    const supabase = await createClient();
    await supabase.from("saved_searches").delete().eq("id", sid).eq("org_id", ws.org.id);
    revalidatePath("/discover");
    return ok(null);
  });
}

export async function touchSavedSearchAction(id: unknown, resultCount: unknown) {
  const ws = await requireRole("sales_rep");
  const sid = z.string().uuid().parse(id);
  const count = z.number().int().min(0).parse(resultCount);
  const supabase = await createClient();
  await supabase.from("saved_searches").update({ last_run_at: new Date().toISOString(), last_result_count: count }).eq("id", sid).eq("org_id", ws.org.id);
}

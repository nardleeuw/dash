"use server";
import { z } from "zod";
import { requireRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { ok, safeAction, type ActionResult } from "@/server/actions";
import { getCreditStatus } from "@/server/usage";
import { applyLeadFilters, leadSelect } from "@/server/leads/query";
import { getDictionary } from "@/i18n/server";

/** Data for the generation dialog: sender profiles, remaining credits, filter size. */
export async function generationContextAction(filter: unknown): Promise<ActionResult<{ profiles: { id: string; label: string; complete: boolean }[]; remaining: number; filterTotal: number }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const f = z.record(z.string(), z.string().max(200)).parse(filter ?? {});
    const supabase = await createClient();
    const t = await getDictionary();
    const [{ data: profiles }, credits, countRes] = await Promise.all([
      supabase.from("agency_profiles").select("id, client_id, services, agency_clients(name)").eq("org_id", ws.org.id).order("created_at"),
      getCreditStatus(ws.org.id),
      applyLeadFilters(supabase.from("businesses").select(leadSelect("id", f), { count: "exact", head: true }).eq("org_id", ws.org.id), f),
    ]);
    const gen = credits.find((c) => c.kind === "email_generation");
    return ok({
      profiles: (profiles ?? []).map((p) => ({ id: p.id, label: p.client_id ? (p.agency_clients as unknown as { name: string } | null)?.name ?? "Client" : t.emails.defaultProfile, complete: ((p.services as unknown[]) ?? []).length > 0 })),
      remaining: gen ? Math.max(0, gen.allowance - gen.used) : 0,
      filterTotal: countRes.count ?? 0,
    });
  });
}

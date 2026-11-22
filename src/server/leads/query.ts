import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LeadParams = Record<string, string | undefined>;

const DIGITAL: [string, string, string][] = [
  ["nobooking", "booking", "false"], ["notmobile", "mobile", "false"], ["nohttps", "https", "false"],
  ["noform", "contact_form", "false"], ["outdated", "outdated", "true"],
];

type Filterable = {
  eq(column: string, value: unknown): Filterable;
  or(filters: string): Filterable;
  gte(column: string, value: unknown): Filterable;
  gt(column: string, value: unknown): Filterable;
  not(column: string, operator: string, value: unknown): Filterable;
};

/** Shared lead-database filter used by the list page and bulk "all in filter" actions. */
export function applyLeadFilters<Q>(query: Q, p: LeadParams): Q {
  let q = query as unknown as Filterable;
  const text = p.q?.trim();
  if (text) {
    const safe = text.replace(/[,()%*\\]/g, " ").slice(0, 80);
    q = /^\d{8}$/.test(safe) ? q.eq("kvk_number", safe) : q.or(`name.ilike.%${safe}%,city.ilike.%${safe}%`);
  }
  if (p.status) q = q.eq("lead_status", p.status);
  if (p.province) q = q.eq("province", p.province);
  if (p.industry) q = q.eq("industry", p.industry);
  const minScore = Number(p.minScore ?? 0) || 0;
  if (minScore > 0) q = q.gte("lead_score", minScore);
  if (p.website === "1") q = q.not("website_url", "is", null);
  if (p.phone === "1") q = q.not("phone", "is", null);
  if (p.multi === "1") q = q.gt("location_count", 1);
  if (p.nonmailing === "0") q = q.eq("kvk_non_mailing", false);
  if (p.email === "1") q = q.not("contacts.email", "is", null);
  if (p.list) q = q.eq("lead_list_members.list_id", p.list);
  for (const [param, key, value] of DIGITAL) if (p[param] === "1") q = q.eq(`digital_signals->>${key}`, value);
  if (p.researched === "1") q = q.not("last_researched_at", "is", null);
  return q as unknown as Q;
}

export function leadSelect(base: string, p: LeadParams) {
  return [base, p.email === "1" ? "contacts!inner(id)" : "", p.list ? "lead_list_members!inner(list_id)" : ""].filter(Boolean).join(", ");
}

/** Resolve all business ids matching a filter (capped). */
export async function leadIdsForFilter(db: SupabaseClient, orgId: string, p: LeadParams, cap = 1000): Promise<string[]> {
  const query = applyLeadFilters(db.from("businesses").select(leadSelect("id", p)).eq("org_id", orgId), p);
  const { data, error } = await query.limit(cap);
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string }[]).map((r) => r.id);
}

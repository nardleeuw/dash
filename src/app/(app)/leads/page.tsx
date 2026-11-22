import Link from "next/link";
import { Database, Search } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getWorkspace } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { fmt, formatNumber } from "@/i18n/format";
import { INDUSTRIES } from "@/config/industries";
import { PROVINCES } from "@/config/geo";
import { LeadsFilters } from "./leads-filters";
import { applyLeadFilters, leadSelect } from "@/server/leads/query";
import { LeadsTable, type LeadRow } from "./leads-table";

export const metadata = { title: "Leaddatabase" };

const PAGE_SIZE = 50;

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : undefined;
}

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const sp = await searchParams;
  const page = Math.max(1, Number(str(sp.page) ?? 1) || 1);
  const list = str(sp.list);
  const params = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, str(v)]));

  const supabase = await createClient();
  const base = "id, name, kvk_number, city, province, industry, website_url, phone, lead_status, lead_score, is_mock, kvk_non_mailing, location_count, legal_form, created_at";
  let query = applyLeadFilters(supabase.from("businesses").select(leadSelect(base, params), { count: "exact" }).eq("org_id", ws.org.id), params);

  const sort = str(sp.sort) ?? "created";
  query = sort === "score" ? query.order("lead_score", { ascending: false, nullsFirst: false }) : sort === "name" ? query.order("name") : query.order("created_at", { ascending: false });
  const { data, count, error } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw error;

  const [{ data: lists }, { count: total }] = await Promise.all([
    supabase.from("lead_lists").select("id, name").eq("org_id", ws.org.id).order("name"),
    supabase.from("businesses").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id),
  ]);

  const rows = (data ?? []) as unknown as LeadRow[];
  const locale = t.meta.locale as "nl" | "en";

  if ((total ?? 0) === 0) {
    return (
      <>
        <PageHeader title={t.leads.title} description={t.leads.subtitle} />
        <EmptyState icon={Database} title={t.leads.empty} description={t.leads.emptyText} action={<Button asChild><Link href="/discover"><Search />{t.leads.goDiscover}</Link></Button>} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t.leads.title} description={t.leads.subtitle} />
      <LeadsFilters
        industries={INDUSTRIES.map((i) => ({ key: i.key, label: i[locale] }))}
        provinces={PROVINCES.map((p) => p.name)}
        lists={lists ?? []}
      />
      <LeadsTable
        rows={rows}
        total={count ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
        lists={lists ?? []}
        role={ws.role}
        countLabel={fmt(t.leads.count, { count: formatNumber(count ?? 0, t.meta.dateLocale) })}
        industryLabels={Object.fromEntries(INDUSTRIES.map((i) => [i.key, i[locale]]))}
        activeListId={list ?? null}
      />
    </>
  );
}

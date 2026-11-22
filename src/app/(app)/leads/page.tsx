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
import { LeadsTable, type LeadRow } from "./leads-table";

export const metadata = { title: "Leaddatabase" };

const PAGE_SIZE = 50;

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : undefined;
}

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const sp = await searchParams;
  const q = str(sp.q)?.trim();
  const status = str(sp.status);
  const province = str(sp.province);
  const industry = str(sp.industry);
  const list = str(sp.list);
  const minScore = Number(str(sp.minScore) ?? 0) || 0;
  const hasWebsite = str(sp.website) === "1";
  const hasEmail = str(sp.email) === "1";
  const hasPhone = str(sp.phone) === "1";
  const multi = str(sp.multi) === "1";
  const hideNonMailing = str(sp.nonmailing) === "0";
  const digital: [string, string, string][] = [
    ["nobooking", "booking", "false"], ["notmobile", "mobile", "false"], ["nohttps", "https", "false"],
    ["noform", "contact_form", "false"], ["outdated", "outdated", "true"],
  ];
  const researched = str(sp.researched) === "1";
  const page = Math.max(1, Number(str(sp.page) ?? 1) || 1);

  const supabase = await createClient();
  const select = [
    "id, name, kvk_number, city, province, industry, website_url, phone, lead_status, lead_score, is_mock, kvk_non_mailing, location_count, legal_form, created_at",
    hasEmail ? "contacts!inner(id)" : "",
    list ? "lead_list_members!inner(list_id)" : "",
  ].filter(Boolean).join(", ");

  let query = supabase.from("businesses").select(select, { count: "exact" }).eq("org_id", ws.org.id);
  if (q) {
    const safe = q.replace(/[,()%*\\]/g, " ").slice(0, 80);
    query = /^\d{8}$/.test(safe) ? query.eq("kvk_number", safe) : query.or(`name.ilike.%${safe}%,city.ilike.%${safe}%`);
  }
  if (status) query = query.eq("lead_status", status);
  if (province) query = query.eq("province", province);
  if (industry) query = query.eq("industry", industry);
  if (minScore > 0) query = query.gte("lead_score", minScore);
  if (hasWebsite) query = query.not("website_url", "is", null);
  if (hasPhone) query = query.not("phone", "is", null);
  if (multi) query = query.gt("location_count", 1);
  if (hideNonMailing) query = query.eq("kvk_non_mailing", false);
  if (hasEmail) query = query.not("contacts.email", "is", null);
  for (const [param, key, value] of digital) if (str(sp[param]) === "1") query = query.eq(`digital_signals->>${key}`, value);
  if (researched) query = query.not("last_researched_at", "is", null);
  if (list) query = query.eq("lead_list_members.list_id", list);

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

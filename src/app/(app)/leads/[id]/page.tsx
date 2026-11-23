import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Globe, MapPin, Phone } from "lucide-react";
import { getWorkspace } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScoreBadge } from "@/components/app/badges";
import { industryLabel } from "@/config/industries";
import { formatPostalCode } from "@/server/discovery/normalize";
import { ProfileControls } from "./profile-controls";
import { AddContactButton } from "./add-contact";
import { FindContactsButton, VerifyEmailButton } from "./research-buttons";
import { ProfileExtraTabs, ProfileExtraTriggers } from "./extra-tabs";

type Attr = { attribute: string; provider: string; retrieved_at: string; expires_at: string | null; location_id: string | null };

export default async function BusinessProfilePage({ params, searchParams }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  const { tab } = await searchParams;
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const supabase = await createClient();
  const { data: b } = await supabase.from("businesses").select("*").eq("id", id).eq("org_id", ws.org.id).maybeSingle();
  if (!b) notFound();

  const [locations, tradeNames, websites, contacts, sources, attrs, activities, members] = await Promise.all([
    supabase.from("business_locations").select("*").eq("business_id", id).order("is_main", { ascending: false }),
    supabase.from("business_trade_names").select("name, is_primary, source").eq("business_id", id),
    supabase.from("websites").select("id, url, domain, is_primary, verification_status, source").eq("business_id", id),
    supabase.from("contacts").select("id, full_name, job_title, email, email_type, recipient_category, email_verification, phone, source, is_mock").eq("business_id", id).order("created_at"),
    supabase.from("business_sources").select("id, provider, external_id, retrieved_at, retention_class, expires_at, is_exportable, attribution, location_id").eq("business_id", id).order("retrieved_at", { ascending: false }),
    supabase.from("business_attributes").select("attribute, provider, retrieved_at, expires_at, location_id").eq("business_id", id),
    supabase.from("activities").select("id, type, data, created_at, actor_id").eq("business_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("organization_members").select("user_id, users!organization_members_user_id_fkey(full_name, email)").eq("org_id", ws.org.id),
  ]);

  const locale = t.meta.dateLocale;
  const p = t.leads.profile;
  const golden = (b.golden_sources ?? {}) as Record<string, string>;
  const attrRows = (attrs.data ?? []) as Attr[];

  const prov = (field: string, locationId: string | null = null) => {
    const provider = locationId ? undefined : golden[field];
    const row = attrRows.find((a) => a.attribute === field && a.location_id === locationId && (!provider || a.provider === provider));
    if (!row) return null;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="ml-1.5 inline-flex cursor-help items-center rounded border px-1 text-[10px] font-medium text-muted-foreground">{(t.providers as Record<string, string>)[row.provider] ?? row.provider}</span>
        </TooltipTrigger>
        <TooltipContent>
          {p.retrieved}: {formatDate(row.retrieved_at, locale, true)}
          {row.expires_at && <><br />{p.expires}: {formatDate(row.expires_at, locale)}</>}
        </TooltipContent>
      </Tooltip>
    );
  };

  const fieldRow = (label: string, value: React.ReactNode, field?: string) => (
    <div key={label} className="grid grid-cols-[160px_1fr] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{value || <span className="text-muted-foreground">—</span>}{field && value ? prov(field) : null}</dd>
    </div>
  );

  const memberOptions = (members.data ?? []).map((m) => {
    const u = m.users as unknown as { full_name: string | null; email: string } | null;
    return { id: m.user_id as string, name: u?.full_name || u?.email || "—" };
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t.leads.title}</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border bg-muted"><Building2 className="size-5 text-muted-foreground" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[22px] font-semibold tracking-tight">{b.name}</h1>
                {b.is_mock && <Badge variant="mock">{p.mockRecord}</Badge>}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {b.city && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{b.city}{b.province ? `, ${b.province}` : ""}</span>}
                {b.industry && <span>{industryLabel(b.industry, t.meta.locale as "nl" | "en")}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ScoreBadge score={b.lead_score} className="h-8 min-w-11 text-sm" />
            <ProfileControls businessId={b.id} status={b.lead_status} assignedTo={b.assigned_to} tags={b.tags ?? []} members={memberOptions} canWrite={ws.role !== "viewer"} />
          </div>
        </div>
      </div>

      <Tabs defaultValue={typeof tab === "string" ? tab : "overview"}>
        <TabsList>
          <TabsTrigger value="overview">{p.overview}</TabsTrigger>
          <ProfileExtraTriggers />
          <TabsTrigger value="sources">{p.sources}</TabsTrigger>
          <TabsTrigger value="activity">{p.activity}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>{p.details}</CardTitle></CardHeader>
              <CardContent className="pt-2">
                <dl className="divide-y">
                  {fieldRow(t.common.name, b.name, "name")}
                  {fieldRow(p.legalForm, b.legal_form, "legal_form")}
                  {fieldRow(t.leads.industry, industryLabel(b.industry, t.meta.locale as "nl" | "en"), "industry")}
                  {fieldRow(p.sbi, (b.sbi_codes ?? []).join(", "), "sbi_codes")}
                  {fieldRow(p.employees, b.employee_range, "employee_range")}
                  {fieldRow(p.registered, b.registration_date ? formatDate(b.registration_date, locale) : null)}
                  {fieldRow(t.common.website, b.website_url ? <a className="inline-flex items-center gap-1 text-primary hover:underline" href={b.website_url} target="_blank" rel="noopener noreferrer nofollow"><Globe className="size-3.5" />{b.domain}</a> : null, "website_url")}
                  {fieldRow(t.common.phone, b.phone ? <span className="inline-flex items-center gap-1"><Phone className="size-3.5" />{b.phone}</span> : null, "phone")}
                  {b.rating != null && fieldRow(t.discover.columns.rating, `${b.rating} (${b.review_count ?? 0})`)}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>{p.locations} ({locations.data?.length ?? 0}{b.location_count && b.location_count > (locations.data?.length ?? 0) ? ` / ${b.location_count}` : ""})</CardTitle></CardHeader>
              <CardContent className="space-y-3 pt-2">
                {(locations.data ?? []).map((l) => (
                  <div key={l.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{l.name ?? b.name}</span>
                      <Badge variant={l.is_main ? "default" : "secondary"}>{l.is_main ? p.main : p.branch}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {[l.street, [l.house_number, l.house_number_addition].filter(Boolean).join("")].filter(Boolean).join(" ")}
                      {l.street ? ", " : ""}{[formatPostalCode(l.postal_code), l.city].filter(Boolean).join(" ")}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      {l.establishment_number && <span className="tabular">{p.establishmentNumber} {l.establishment_number}</span>}
                      {l.municipality && <span>{l.municipality}</span>}
                      {l.google_place_id && <span>Google place</span>}
                      {l.osm_id && <span>OSM {l.osm_id}</span>}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{p.contacts}</CardTitle>
                {ws.role !== "viewer" && (
                  <div className="flex gap-2">
                    {b.domain && <FindContactsButton businessId={b.id} />}
                    <AddContactButton businessId={b.id} />
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-2 pt-3">
                {(contacts.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">{p.noContacts}</p>}
                {(contacts.data ?? []).map((c) => (
                  <div key={c.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{c.full_name || c.email || "—"}</span>
                      <Badge variant="secondary">{(t.providers as Record<string, string>)[c.source] ?? c.source}</Badge>
                    </div>
                    {c.job_title && <p className="text-muted-foreground">{c.job_title}</p>}
                    {c.email && (
                      <p className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-foreground">{c.email}</span>
                        <Badge variant="outline">{c.email_type}</Badge>
                        {c.email_verification !== "unknown" && <Badge variant={c.email_verification === "valid" ? "success" : c.email_verification === "invalid" ? "destructive" : "warning"}>{c.email_verification}</Badge>}
                        {c.email_verification === "unknown" && ws.role !== "viewer" && <VerifyEmailButton contactId={c.id} businessId={b.id} />}
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>{p.tradeNames}</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-1.5 pt-3">
                {(tradeNames.data ?? []).length === 0 && <span className="text-sm text-muted-foreground">—</span>}
                {(tradeNames.data ?? []).map((n) => <Badge key={n.name} variant={n.is_primary ? "default" : "secondary"}>{n.name}</Badge>)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>{p.websites}</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 pt-3 text-sm">
                {(websites.data ?? []).length === 0 && <span className="text-muted-foreground">—</span>}
                {(websites.data ?? []).map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-2">
                    <a href={w.url} className="truncate text-primary hover:underline" target="_blank" rel="noopener noreferrer nofollow">{w.domain}</a>
                    <span className="flex gap-1">
                      <Badge variant="secondary">{(t.providers as Record<string, string>)[w.source] ?? w.source}</Badge>
                      <Badge variant={w.verification_status === "verified" ? "success" : "outline"}>{w.verification_status}</Badge>
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <ProfileExtraTabs businessId={b.id} canWrite={ws.role !== "viewer"} />

        <TabsContent value="sources">
          <Card className="gap-0 overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.common.source}</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>{p.retrieved}</TableHead>
                  <TableHead>{t.meta.locale === "nl" ? "Bewaarregel" : "Retention"}</TableHead>
                  <TableHead>{p.expires}</TableHead>
                  <TableHead>Export</TableHead>
                  <TableHead>{t.meta.locale === "nl" ? "Attributie" : "Attribution"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sources.data ?? []).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell><Badge variant="secondary">{(t.providers as Record<string, string>)[s.provider] ?? s.provider}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{s.external_id ?? "—"}</TableCell>
                    <TableCell className="text-sm">{formatDate(s.retrieved_at, locale, true)}</TableCell>
                    <TableCell className="text-sm">{s.retention_class}</TableCell>
                    <TableCell className="text-sm">{s.expires_at ? formatDate(s.expires_at, locale) : "—"}</TableCell>
                    <TableCell>{s.is_exportable ? <Badge variant="success">{p.exportable}</Badge> : <Badge variant="outline">{p.notExportable}</Badge>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.attribution}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <p className="mt-3 text-xs text-muted-foreground">
            {t.meta.locale === "nl"
              ? "Gegevens van Google Places worden maximaal 30 dagen bewaard; alleen de place-ID blijft. Verlopen gegevens worden automatisch verwijderd."
              : "Google Places data is kept for at most 30 days; only the place ID is retained. Expired data is deleted automatically."}
          </p>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardContent>
              <ol className="relative space-y-4 border-l pl-5">
                {(activities.data ?? []).map((a) => (
                  <li key={a.id} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-background bg-primary" />
                    <p className="font-medium">{a.type.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(a.created_at, locale, true)}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

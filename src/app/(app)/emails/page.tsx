import Link from "next/link";
import { Mail } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { getWorkspace, hasMinRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { INDUSTRIES } from "@/config/industries";
import { ReviewTable, type ReviewRow } from "./review-table";
import { ProfileForm } from "./profile-form";
import { BatchActions } from "./batch-actions";
import { GenerateDialog } from "@/app/(app)/leads/generate-button";

export const metadata = { title: "E-mailgenerator" };

const TABS = ["review", "batches", "profile"] as const;

export default async function EmailsPage({ searchParams }: PageProps<"/emails">) {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(String(sp.tab)) ? String(sp.tab) : "review";
  const filter = typeof sp.filter === "string" ? sp.filter : "all";
  const batchId = typeof sp.batch === "string" ? sp.batch : null;
  const supabase = await createClient();
  const e = t.emails;

  const [{ data: profiles }, { data: lists }, { data: batches }] = await Promise.all([
    supabase.from("agency_profiles").select("*, agency_clients(name)").eq("org_id", ws.org.id).order("created_at"),
    supabase.from("lead_lists").select("id, name").eq("org_id", ws.org.id).order("name"),
    supabase.from("email_generation_batches").select("id, name, source, status, total, created_at, completed_at").eq("org_id", ws.org.id).order("created_at", { ascending: false }).limit(25),
  ]);

  const tabLink = (k: string) => (
    <Link key={k} href={`/emails?tab=${k}`} className={`inline-flex h-full items-center rounded-md px-3 text-sm font-medium ${tab === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
      {(e.tabs as Record<string, string>)[k]}
    </Link>
  );

  const profileOptions = (profiles ?? []).map((p) => ({ id: p.id as string, label: p.client_id ? `${(p.agency_clients as { name: string } | null)?.name ?? "Client"}` : e.defaultProfile, complete: (p.services as unknown[])?.length > 0 }));

  let body: React.ReactNode = null;
  if (tab === "review") {
    let q = supabase
      .from("generated_emails")
      .select("id, business_id, subject, body, recipient_email, opportunity, personalization_score, personalization_evidence, fact_check, generation_status, review_status, compliance_status, compliance_reasons, is_mock, error, updated_at, businesses(name, city), contacts(full_name)")
      .eq("org_id", ws.org.id)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (batchId) q = q.eq("batch_id", batchId);
    if (filter === "pending") q = q.eq("review_status", "pending").eq("generation_status", "completed");
    if (filter === "approved") q = q.eq("review_status", "approved");
    if (filter === "rejected") q = q.eq("review_status", "rejected");
    if (filter === "failed") q = q.eq("generation_status", "failed");
    if (filter === "issues") q = q.eq("fact_check->>passed", "false");
    const { data } = await q;
    const rows = (data ?? []) as unknown as ReviewRow[];
    const active = rows.some((r) => ["queued", "researching", "generating"].includes(r.generation_status));
    body = (
      <>
        {active && <AutoRefresh intervalMs={3000} />}
        {rows.length === 0 && filter === "all" && !batchId ? (
          <EmptyState icon={Mail} title={e.empty} description={e.emptyText} action={<GenerateDialog scope="list" lists={lists ?? []} profiles={profileOptions} trigger="button" />} />
        ) : (
          <ReviewTable rows={rows} filter={filter} batchId={batchId} canWrite={ws.role !== "viewer"} />
        )}
      </>
    );
  } else if (tab === "batches") {
    const ids = (batches ?? []).map((b) => b.id);
    const { data: stats } = ids.length
      ? await supabase.from("generated_emails").select("batch_id, generation_status, review_status").in("batch_id", ids).limit(10000)
      : { data: [] };
    const running = (batches ?? []).some((b) => b.status === "running" || b.status === "queued");
    body = (
      <div className="space-y-3">
        {running && <AutoRefresh intervalMs={3000} />}
        {(batches ?? []).length === 0 && <EmptyState icon={Mail} title={e.empty} description={e.emptyText} />}
        {(batches ?? []).map((b) => {
          const s = (stats ?? []).filter((x) => x.batch_id === b.id);
          const count = (fn: (x: (typeof s)[number]) => boolean) => s.filter(fn).length;
          const done = count((x) => ["completed", "failed", "skipped"].includes(x.generation_status));
          const generated = count((x) => x.generation_status === "completed");
          const failed = count((x) => x.generation_status === "failed");
          const researched = count((x) => ["generating", "completed"].includes(x.generation_status));
          const awaiting = count((x) => x.generation_status === "completed" && x.review_status === "pending");
          const approved = count((x) => x.review_status === "approved");
          const total = b.total || s.length;
          return (
            <Card key={b.id}>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{b.name ?? formatDate(b.created_at, t.meta.dateLocale, true)}</p>
                    <p className="text-xs text-muted-foreground">{b.source} · {formatDate(b.created_at, t.meta.dateLocale, true)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={b.status === "completed" ? "success" : "default"}>{b.status === "completed" ? e.batch.completed : e.batch.running}</Badge>
                    <BatchActions batchId={b.id} failed={failed} canWrite={ws.role !== "viewer"} />
                  </div>
                </div>
                <Progress value={total ? (done / total) * 100 : 0} />
                <div className="grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
                  {[
                    [e.batch.selected, total], [e.batch.researched, researched], [e.batch.generated, generated],
                    [e.batch.failed, failed], [e.batch.awaiting, awaiting], [e.batch.approved, approved],
                  ].map(([label, value]) => (
                    <div key={String(label)}><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold tabular">{value}</p></div>
                  ))}
                </div>
                <Link href={`/emails?tab=review&batch=${b.id}`} className="text-sm font-medium text-primary hover:underline">{e.tabs.review} →</Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  } else {
    const requested = typeof sp.profile === "string" ? sp.profile : null;
    const profile = (profiles ?? []).find((p) => p.id === requested) ?? (profiles ?? []).find((p) => !p.client_id) ?? (profiles ?? [])[0];
    body = profile ? (
      <ProfileForm
        key={profile.id}
        profile={profile as never}
        industries={INDUSTRIES.map((i) => ({ key: i.key, label: t.meta.locale === "en" ? i.en : i.nl }))}
        canEdit={hasMinRole(ws.role, "manager")}
      />
    ) : null;
  }

  return (
    <>
      <PageHeader
        title={e.title}
        description={e.subtitle}
        actions={ws.role !== "viewer" ? <GenerateDialog scope="list" lists={lists ?? []} profiles={profileOptions} trigger="button" /> : null}
      />
      <div className="mb-5 inline-flex h-9 items-center rounded-lg bg-secondary p-1">{TABS.map(tabLink)}</div>
      {body}
    </>
  );
}

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { PageHeader, EmptyState, StatCard } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScoreBadge } from "@/components/app/badges";
import { getWorkspace, hasMinRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { DEFAULT_WEIGHTS } from "@/server/scoring/score";
import { PROVINCES } from "@/config/geo";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { ScoringDialog } from "./scoring-dialog";

export const metadata = { title: "AI-onderzoek" };

const STATUS_VARIANT: Record<string, "secondary" | "default" | "success" | "destructive" | "warning" | "outline"> = {
  queued: "secondary", running: "default", completed: "success", failed: "destructive", blocked: "warning", no_website: "outline",
};

export default async function ResearchPage() {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const supabase = await createClient();
  const [{ data: rows }, { count: total }, { count: running }, { count: completed }, { data: scores }] = await Promise.all([
    supabase.from("website_analyses").select("id, status, created_at, completed_at, is_mock, error, business_id, businesses(name, lead_score, city), opportunities(id)").eq("org_id", ws.org.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("website_analyses").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id),
    supabase.from("website_analyses").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id).in("status", ["queued", "running"]),
    supabase.from("website_analyses").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id).eq("status", "completed"),
    supabase.from("businesses").select("lead_score").eq("org_id", ws.org.id).not("lead_score", "is", null).limit(5000),
  ]);
  const avg = scores?.length ? Math.round(scores.reduce((a, s) => a + (s.lead_score ?? 0), 0) / scores.length) : null;
  const settings = ws.org.settings as { scoring_weights?: Record<string, number>; target_provinces?: string[] };
  const r = t.research;

  return (
    <>
      <PageHeader
        title={r.title}
        description={r.subtitle}
        actions={hasMinRole(ws.role, "manager") ? <ScoringDialog weights={{ ...DEFAULT_WEIGHTS, ...(settings.scoring_weights ?? {}) }} targetProvinces={settings.target_provinces ?? []} provinces={PROVINCES.map((p) => p.name)} /> : null}
      />
      {(running ?? 0) > 0 && <AutoRefresh intervalMs={4000} />}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label={r.stats.total} value={total ?? 0} />
        <StatCard label={r.stats.running} value={running ?? 0} />
        <StatCard label={r.stats.completed} value={completed ?? 0} />
        <StatCard label={r.stats.avgScore} value={avg ?? "—"} />
      </div>
      {(rows ?? []).length === 0 ? (
        <EmptyState icon={Sparkles} title={r.empty} description={r.emptyText} />
      ) : (
        <Card className="gap-0 overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{r.columns.business}</TableHead>
                <TableHead>{r.columns.status}</TableHead>
                <TableHead>{r.columns.opportunities}</TableHead>
                <TableHead>{r.columns.date}</TableHead>
                <TableHead className="text-right">{r.columns.score}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((a) => {
                const biz = a.businesses as unknown as { name: string; lead_score: number | null; city: string | null } | null;
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/leads/${a.business_id}?tab=research`} className="font-medium hover:text-primary">{biz?.name ?? "—"}</Link>
                      {a.is_mock && <Badge variant="mock" className="ml-2">{t.mock.label}</Badge>}
                      {biz?.city && <div className="text-xs text-muted-foreground">{biz.city}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>{(r.statuses as Record<string, string>)[a.status] ?? a.status}</Badge>
                      {a.error && <div className="mt-1 max-w-xs truncate text-xs text-muted-foreground">{a.error}</div>}
                    </TableCell>
                    <TableCell className="tabular">{(a.opportunities as unknown[]).length}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(a.completed_at ?? a.created_at, t.meta.dateLocale, true)}</TableCell>
                    <TableCell className="text-right"><ScoreBadge score={a.status === "completed" ? biz?.lead_score : null} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}

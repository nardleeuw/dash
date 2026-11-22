import Link from "next/link";
import { PageHeader, StatCard } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getWorkspace, hasMinRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { formatCurrency, formatNumber, formatPercent } from "@/i18n/format";
import { industryLabel } from "@/config/industries";
import { cn } from "@/lib/utils";
import { DailyChart } from "./daily-chart";

export const metadata = { title: "Analytics" };

type Totals = Record<"discovered" | "enriched" | "qualified" | "generated" | "approved" | "sent" | "delivered" | "bounced" | "unsubscribed" | "replies" | "positive" | "meetings" | "customers", number>;
type Row = { key: string; sent: number; replies: number; positive: number; bounced?: number };
type Summary = { totals: Totals; daily: { day: string; sent: number; replies: number; positive: number }[]; by_industry: Row[]; by_province: Row[]; by_campaign: Row[]; by_client: Row[]; by_version: Row[]; reply_categories: Record<string, number> };

const RANGES = ["7", "30", "90", "365"] as const;

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const sp = await searchParams;
  const range = (RANGES as readonly string[]).includes(String(sp.range)) ? String(sp.range) : "30";
  const to = new Date();
  const from = new Date(to.getTime() - Number(range) * 86_400_000);
  const supabase = await createClient();
  const [{ data }, costs] = await Promise.all([
    supabase.rpc("analytics_summary", { p_org: ws.org.id, p_from: from.toISOString(), p_to: to.toISOString() }),
    hasMinRole(ws.role, "admin") ? supabase.rpc("provider_costs", { p_org: ws.org.id, p_from: from.toISOString(), p_to: to.toISOString() }) : Promise.resolve({ data: null }),
  ]);
  const s = data as Summary;
  const a = t.analytics;
  const locale = t.meta.dateLocale;
  const lang = t.meta.locale as "nl" | "en";
  const T = s.totals;
  const rate = (n: number, d: number) => (d > 0 ? formatPercent(n / d, locale) : "—");

  const funnel: (keyof Totals)[] = ["discovered", "enriched", "qualified", "generated", "approved", "sent", "replies", "positive", "meetings", "customers"];
  const max = Math.max(1, ...funnel.map((k) => T[k]));

  const breakdown = (title: string, rows: Row[], label: (k: string) => string = (k) => k) => (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="pt-2">
        <Table>
          <TableHeader><TableRow><TableHead>{a.columns.key}</TableHead><TableHead className="text-right">{a.columns.sent}</TableHead><TableHead className="text-right">{a.columns.replies}</TableHead><TableHead className="text-right">{a.columns.positive}</TableHead><TableHead className="text-right">{a.columns.rate}</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">—</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="text-sm">{label(r.key)}</TableCell>
                <TableCell className="text-right tabular">{r.sent}</TableCell>
                <TableCell className="text-right tabular">{r.replies}</TableCell>
                <TableCell className="text-right tabular">{r.positive}</TableCell>
                <TableCell className="text-right tabular">{rate(r.replies, r.sent)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <>
      <PageHeader title={a.title} description={a.subtitle} />
      <div className="mb-5 flex gap-1.5">
        {RANGES.map((r) => (
          <Link key={r} href={`/analytics?range=${r}`} className={cn("rounded-full border px-3 py-1 text-xs font-medium", range === r ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground")}>{a.range[r]}</Link>
        ))}
      </div>

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label={a.rates.reply} value={rate(T.replies, T.sent)} hint={`${formatNumber(T.replies, locale)} / ${formatNumber(T.sent, locale)}`} />
          <StatCard label={a.rates.positive} value={rate(T.positive, T.sent)} hint={`${formatNumber(T.positive, locale)} ${a.totals.positive.toLowerCase()}`} />
          <StatCard label={a.rates.meeting} value={rate(T.meetings, T.positive)} hint={`${formatNumber(T.meetings, locale)} ${a.totals.meetings.toLowerCase()}`} />
          <StatCard label={a.rates.lead} value={rate(T.customers, T.sent)} hint={`${formatNumber(T.customers, locale)} ${a.totals.customers.toLowerCase()}`} />
          <StatCard label={a.rates.bounce} value={rate(T.bounced, T.sent)} hint={`${formatNumber(T.bounced, locale)} ${a.totals.bounced.toLowerCase()}`} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
          <Card>
            <CardHeader><CardTitle>{a.funnel}</CardTitle></CardHeader>
            <CardContent className="space-y-2.5 pt-3">
              {funnel.map((k) => (
                <div key={k} className="grid grid-cols-[130px_1fr_56px] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{a.totals[k]}</span>
                  <div className="h-2.5 rounded-r bg-secondary">
                    <div className="h-full rounded-r-[4px] bg-primary" style={{ width: `${(T[k] / max) * 100}%`, minWidth: T[k] ? 3 : 0 }} />
                  </div>
                  <span className="text-right font-medium tabular">{formatNumber(T[k], locale)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{a.daily}</CardTitle></CardHeader>
            <CardContent className="pt-3">
              <DailyChart data={s.daily} labels={{ sent: a.totals.sent, replies: a.totals.replies, positive: a.totals.positive }} locale={locale} />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          {breakdown(a.byCampaign, s.by_campaign)}
          {breakdown(a.byIndustry, s.by_industry, (k) => industryLabel(k, lang) ?? k)}
          {breakdown(a.byProvince, s.by_province)}
          {breakdown(a.byClient, s.by_client)}
          {breakdown(a.byVersion, s.by_version)}
          <Card>
            <CardHeader><CardTitle>{a.categories}</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-3">
              {Object.keys(s.reply_categories).length === 0 && <p className="text-sm text-muted-foreground">—</p>}
              {Object.entries(s.reply_categories).sort((x, y) => y[1] - x[1]).map(([k, v]) => {
                const total = Object.values(s.reply_categories).reduce((p, c) => p + c, 0);
                return (
                  <div key={k} className="grid grid-cols-[150px_1fr_40px] items-center gap-3 text-sm">
                    <span className="text-muted-foreground">{(t.inbox.categories as Record<string, string>)[k] ?? k}</span>
                    <div className="h-2 rounded-r bg-secondary"><div className="h-full rounded-r-[4px] bg-primary" style={{ width: `${(v / total) * 100}%` }} /></div>
                    <span className="text-right tabular">{v}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {costs.data && (
          <Card>
            <CardHeader><CardTitle>{a.costs}</CardTitle></CardHeader>
            <CardContent className="pt-2">
              <Table>
                <TableHeader><TableRow><TableHead>{t.common.source}</TableHead><TableHead className="text-right">{a.calls}</TableHead><TableHead className="text-right">Errors</TableHead><TableHead className="text-right">Tokens</TableHead><TableHead className="text-right">{a.cost}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(costs.data as { provider: string; calls: number; errors: number; cost_micros: number; input_tokens: number; output_tokens: number }[]).map((c) => (
                    <TableRow key={c.provider}>
                      <TableCell className="text-sm">{(t.providers as Record<string, string>)[c.provider] ?? c.provider}</TableCell>
                      <TableCell className="text-right tabular">{formatNumber(c.calls, locale)}</TableCell>
                      <TableCell className="text-right tabular">{formatNumber(c.errors, locale)}</TableCell>
                      <TableCell className="text-right tabular">{formatNumber(Number(c.input_tokens) + Number(c.output_tokens), locale)}</TableCell>
                      <TableCell className="text-right tabular">{formatCurrency(Number(c.cost_micros) / 10_000, locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

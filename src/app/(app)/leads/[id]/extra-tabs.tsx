import { AlertTriangle, CheckCircle2, CircleSlash, ExternalLink, Lightbulb, Quote, ShieldAlert } from "lucide-react";
import { TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { ScoreBadge } from "@/components/app/badges";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { fmt, formatDate } from "@/i18n/format";
import { ResearchButton } from "./research-buttons";
import { ProfileEmailsTab, ProfileEmailsTrigger } from "./emails-tab";
import { ProfileCrmTab, ProfileCrmTrigger } from "./crm-tab";

export async function ProfileExtraTriggers() {
  const t = await getDictionary();
  return (
    <>
      <TabsTrigger value="research">{t.leads.profile.research}</TabsTrigger>
      <ProfileEmailsTrigger />
      <ProfileCrmTrigger />
    </>
  );
}

type Signals = Record<string, unknown> & { evidence?: Record<string, { url: string; detail: string }[]> };
type Research = {
  summary?: string; services?: string[]; targetCustomers?: string[];
  observations?: { text: string; quote: string; source_url: string; category: string }[];
  hypotheses?: { text: string; reasoning: string; confidence: number }[];
  injectionDetected?: boolean; aiError?: string | null; crawlNote?: string | null; rejectedObservations?: number;
};
type Factor = { key: string; weight: number; score: number; reason: string; evidence: string[] };

export async function ProfileExtraTabs({ businessId, canWrite }: { businessId: string; canWrite: boolean }) {
  const t = await getDictionary();
  const r = t.research;
  const supabase = await createClient();
  const [{ data: analyses }, { data: opps }, { data: score }] = await Promise.all([
    supabase.from("website_analyses").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(1),
    supabase.from("opportunities").select("*").eq("business_id", businessId).eq("status", "open").order("is_verified", { ascending: false }).order("confidence", { ascending: false }),
    supabase.from("lead_scores").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const a = analyses?.[0];
  const running = a && (a.status === "queued" || a.status === "running");
  const research = (a?.research ?? {}) as Research;
  const signals = (a?.signals ?? {}) as Signals;
  const sigKeys: [string, string, boolean][] = [
    ["https", "https", false], ["mobile", "mobileViewport", false], ["booking", "hasOnlineBooking", false], ["ordering", "hasOnlineOrdering", false],
    ["contact_form", "hasContactForm", false], ["quote_form", "hasQuoteForm", false], ["chat", "hasLiveChat", false], ["analytics", "hasAnalytics", false], ["outdated", "outdatedCopyright", true],
  ];

  return (
    <>
      <TabsContent value="research" className="space-y-6">
        {running && <AutoRefresh intervalMs={3000} />}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {a ? <>{(r.statuses as Record<string, string>)[a.status]} · {formatDate(a.completed_at ?? a.created_at, t.meta.dateLocale, true)}{a.model && <> · {a.model}</>}</> : r.noAnalysis}
          </p>
          {canWrite && <ResearchButton businessId={businessId} label={a ? r.rerun : r.start} disabled={!!running} />}
        </div>

        {research.injectionDetected && <Alert variant="warning"><ShieldAlert /><AlertDescription className="text-foreground">{r.injectionWarning}</AlertDescription></Alert>}
        {research.aiError && <Alert variant="info"><AlertTriangle /><AlertDescription className="text-foreground">{fmt(r.aiUnavailable, { reason: (r.aiReasons as Record<string, string>)[research.aiError] ?? research.aiError })}</AlertDescription></Alert>}
        {a?.status === "blocked" && <Alert variant="warning"><CircleSlash /><AlertDescription className="text-foreground">{fmt(r.blocked, { reason: a.error ?? "" })}</AlertDescription></Alert>}

        {a && !running && (
          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <div className="space-y-6">
              {research.summary && (
                <Card>
                  <CardHeader><CardTitle>{r.summary}</CardTitle></CardHeader>
                  <CardContent className="space-y-4 pt-2 text-sm leading-relaxed">
                    <p>{research.summary}</p>
                    {!!research.services?.length && (
                      <div><p className="mb-1.5 text-xs font-medium text-muted-foreground">{r.services}</p><div className="flex flex-wrap gap-1.5">{research.services.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}</div></div>
                    )}
                    {!!research.targetCustomers?.length && (
                      <div><p className="mb-1.5 text-xs font-medium text-muted-foreground">{r.targetCustomers}</p><div className="flex flex-wrap gap-1.5">{research.targetCustomers.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}</div></div>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader><CardTitle>{r.opportunities}</CardTitle></CardHeader>
                <CardContent className="space-y-3 pt-2">
                  {(opps ?? []).length === 0 && <p className="text-sm text-muted-foreground">—</p>}
                  {(opps ?? []).map((o) => (
                    <div key={o.id} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{o.title}</p>
                        <div className="flex items-center gap-1.5">
                          {o.is_verified ? <Badge variant="success"><CheckCircle2 />{r.verified}</Badge> : <Badge variant="warning"><Lightbulb />{r.hypothesis}</Badge>}
                          <Badge variant="outline">{r.confidence} {Math.round(Number(o.confidence) * 100)}%</Badge>
                        </div>
                      </div>
                      <p className="mt-1.5 text-sm text-muted-foreground">{o.description}</p>
                      {o.recommended_service && <p className="mt-2 text-xs"><span className="text-muted-foreground">{r.recommended}:</span> <span className="font-medium">{o.recommended_service}</span></p>}
                      {(o.evidence as { kind: string; text: string; quote?: string; source_url?: string }[]).length > 0 && (
                        <ul className="mt-2 space-y-1 border-l-2 pl-3 text-xs text-muted-foreground">
                          {(o.evidence as { kind: string; text: string; quote?: string; source_url?: string }[]).slice(0, 3).map((e, i) => (
                            <li key={i}>
                              {e.quote ? <>“{e.quote}”</> : e.text}
                              {e.source_url && <a href={e.source_url} target="_blank" rel="noopener noreferrer nofollow" className="ml-1 inline-flex items-center text-primary"><ExternalLink className="size-3" /></a>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{r.observations}</CardTitle>
                  <CardDescription>{r.observationsHint}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-3">
                  {(research.observations ?? []).length === 0 && <p className="text-sm text-muted-foreground">—</p>}
                  {(research.observations ?? []).map((o, i) => (
                    <div key={i} className="text-sm">
                      <p>{o.text}</p>
                      <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground"><Quote className="mt-0.5 size-3 shrink-0" />“{o.quote}” <a href={o.source_url} target="_blank" rel="noopener noreferrer nofollow" className="shrink-0 text-primary">{new URL(o.source_url).pathname || "/"}</a></p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {(research.hypotheses ?? []).length > 0 && (
                <Card className="border-dashed">
                  <CardHeader>
                    <CardTitle>{r.hypotheses}</CardTitle>
                    <CardDescription>{r.hypothesesHint}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-3">
                    {(research.hypotheses ?? []).map((h, i) => (
                      <div key={i} className="text-sm">
                        <p className="flex items-center gap-2">{h.text} <Badge variant="outline">{Math.round(h.confidence * 100)}%</Badge></p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{h.reasoning}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-6">
              {score && (
                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>{r.scoreBreakdown}</CardTitle>
                    <ScoreBadge score={score.total} className="h-8 min-w-11 text-sm" />
                  </CardHeader>
                  <CardContent className="space-y-4 pt-3">
                    {(score.factors as Factor[]).map((f) => (
                      <div key={f.key}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{(r.factors as Record<string, string>)[f.key] ?? f.key}</span>
                          <span className="tabular text-muted-foreground">{f.score} · {r.weight} {f.weight}</span>
                        </div>
                        <Progress value={f.score} className="mt-1.5" />
                        <p className="mt-1 text-xs text-muted-foreground">{f.reason}</p>
                      </div>
                    ))}
                    {score.recommended_service && <p className="border-t pt-3 text-sm"><span className="text-muted-foreground">{r.recommended}:</span> <span className="font-medium">{score.recommended_service}</span></p>}
                  </CardContent>
                </Card>
              )}

              {Object.keys(signals).length > 0 && (
                <Card>
                  <CardHeader><CardTitle>{r.signals}</CardTitle></CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 pt-3">
                    {sigKeys.map(([label, key, inverted]) => {
                      const v = Boolean(signals[key]);
                      const good = inverted ? !v : v;
                      return (
                        <div key={key} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                          {good ? <CheckCircle2 className="size-4 text-success" /> : <CircleSlash className="size-4 text-destructive" />}
                          {(r.signalLabels as Record<string, string>)[label]}
                        </div>
                      );
                    })}
                    {typeof signals.cms === "string" && <p className="col-span-2 pt-1 text-xs text-muted-foreground">CMS: {signals.cms}</p>}
                  </CardContent>
                </Card>
              )}

              {(a.pages as { url: string; title: string }[]).length > 0 && (
                <Card>
                  <CardHeader><CardTitle>{r.pagesAnalysed}</CardTitle></CardHeader>
                  <CardContent className="space-y-1 pt-3 text-sm">
                    {(a.pages as { url: string; title: string }[]).map((p) => (
                      <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-primary hover:underline">{p.title || p.url}</a>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </TabsContent>
      <ProfileEmailsTab businessId={businessId} canWrite={canWrite} />
      <ProfileCrmTab businessId={businessId} />
    </>
  );
}

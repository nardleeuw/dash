import { AlertTriangle, CheckCircle2, FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getWorkspace, hasMinRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { fmt, formatCurrency, formatDate, formatNumber } from "@/i18n/format";
import { getCreditStatus } from "@/server/usage";
import { stripeMode } from "@/server/billing/stripe";
import { PlanButton, PackButton, PortalButton, PlanAdmin, SpendCapForm } from "./billing-client";
import { USAGE_PLAN_KEY, billable } from "@/config/billing";
import { monthlySpend, monthStart } from "@/server/usage";

type UsageRow = { provider: string; operation: string; calls: number; cost_micros: number };

/** Customer-facing usage groups (what they did, not which vendor). */
function groupUsage(rows: UsageRow[]) {
  const key = (r: UsageRow) =>
    r.provider === "google_places" ? (r.operation === "details" ? "import" : "search")
    : r.provider === "hunter" || (r.provider === "openai" && r.operation === "contacts") ? "emails_found"
    : r.provider === "openai" && r.operation === "email" ? "emails_written"
    : r.provider === "openai" && ["research", "scoring"].includes(r.operation) ? "research"
    : r.provider === "openai" && r.operation === "replies" ? "replies"
    : r.provider === "kvk" ? "kvk" : "other";
  const m = new Map<string, { key: string; calls: number; costMicros: number }>();
  for (const r of rows) {
    const g = m.get(key(r)) ?? { key: key(r), calls: 0, costMicros: 0 };
    g.calls += Number(r.calls);
    g.costMicros += Number(r.cost_micros);
    m.set(g.key, g);
  }
  return [...m.values()].sort((a, b) => b.costMicros - a.costMicros);
}

export const metadata = { title: "Abonnement" };

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: sub }, { data: plans }, { data: packs }, credits, { data: seats }] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("org_id", ws.org.id).single(),
    supabase.from("plans").select("*").order("sort_order"),
    supabase.from("credit_packs").select("*").eq("is_active", true),
    getCreditStatus(ws.org.id),
    supabase.rpc("seat_status", { p_org: ws.org.id }),
  ]);
  const usagePlan = sub?.plan_key === USAGE_PLAN_KEY;
  const [spend, { data: breakdown }] = await Promise.all([
    monthlySpend(ws.org.id),
    usagePlan ? supabase.rpc("usage_breakdown", { p_org: ws.org.id, p_from: monthStart() }) : Promise.resolve({ data: [] }),
  ]);
  const b = t.billing;
  const locale = t.meta.dateLocale;
  const mode = stripeMode();
  const current = (plans ?? []).find((p) => p.key === sub?.plan_key);
  const trialExpired = sub?.status === "trialing" && sub.trial_ends_at && new Date(sub.trial_ends_at) < new Date();
  const seat = (seats as { used: number; allowed: number }[] | null)?.[0];
  const isOwner = hasMinRole(ws.role, "owner");

  return (
    <>
      <PageHeader title={b.title} description={b.subtitle} actions={mode === "live" && sub?.stripe_customer_id && isOwner ? <PortalButton /> : null} />
      {(() => {
        const chosen = (plans ?? []).find((p) => p.key === (typeof sp.plan === "string" ? sp.plan : null) && p.is_public);
        if (!chosen || (sub?.plan_key === chosen.key && sub?.status === "active")) return null;
        return (
          <Card className="mb-6 border-primary ring-1 ring-primary">
            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-base font-semibold">{fmt(b.checkoutTitle, { plan: chosen.name })}</p>
                <p className="text-sm text-muted-foreground">{fmt(chosen.key === USAGE_PLAN_KEY ? b.checkoutUsageText : b.checkoutText, { price: formatCurrency(chosen.price_cents, locale) })}</p>
              </div>
              {isOwner && <PlanButton planKey={chosen.key} label={b.checkoutCta} />}
            </CardContent>
          </Card>
        );
      })()}
      <div className="space-y-6">
        {mode !== "live" && <Alert variant="warning"><FlaskConical /><AlertDescription className="text-foreground">{b.demoMode}</AlertDescription></Alert>}
        {sp.checkout === "success" && <Alert variant="success"><CheckCircle2 /><AlertDescription className="text-foreground">{b.checkoutSuccess}</AlertDescription></Alert>}
        {trialExpired && <Alert variant="destructive"><AlertTriangle /><AlertDescription className="text-foreground">{b.trialExpired}</AlertDescription></Alert>}

        {usagePlan && spend ? (
          <Card>
            <CardHeader>
              <CardDescription>{b.usageThisMonth}</CardDescription>
              <CardTitle className="text-3xl tracking-tight">{formatCurrency(spend.billableCents, locale)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm"><span>{b.spendCap}</span><span className="tabular text-muted-foreground">{formatCurrency(spend.billableCents, locale)} / {formatCurrency(spend.capCents, locale)}</span></div>
                <Progress value={spend.capCents ? Math.min(100, (spend.billableCents / spend.capCents) * 100) : 0} className="mt-1.5" />
              </div>
              <div className="divide-y rounded-lg border text-sm">
                {groupUsage((breakdown ?? []) as UsageRow[]).map((g) => (
                  <div key={g.key} className="flex justify-between px-3 py-2"><span>{(b.usageGroups as Record<string, string>)[g.key] ?? g.key} <span className="text-muted-foreground">· {formatNumber(g.calls, locale)}×</span></span><span className="tabular">{formatCurrency(billable(Math.round(g.costMicros / 10_000)), locale)}</span></div>
                ))}
                {(breakdown ?? []).length === 0 && <p className="px-3 py-2 text-muted-foreground">{b.noUsage}</p>}
              </div>
              <p className="text-xs text-muted-foreground">{b.usageNote}</p>
              {isOwner && <SpendCapForm capCents={spend.capCents} />}
            </CardContent>
          </Card>
        ) : (
          (plans ?? []).some((p) => p.key === USAGE_PLAN_KEY && p.is_public) && (
            <Card className="border-primary ring-1 ring-primary">
              <CardContent className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-base font-semibold">{b.startTitle}</p>
                  <p className="text-sm text-muted-foreground">{fmt(b.checkoutUsageText, { price: formatCurrency((plans ?? []).find((p) => p.key === USAGE_PLAN_KEY)?.price_cents ?? 50000, locale) })}</p>
                </div>
                {isOwner && <div className="w-56"><PlanButton planKey={USAGE_PLAN_KEY} label={b.checkoutCta} /></div>}
              </CardContent>
            </Card>
          )
        )}

        <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
          <Card>
            <CardHeader>
              <CardDescription>{b.currentPlan}</CardDescription>
              <CardTitle className="flex items-center gap-2 text-xl">{current?.name ?? sub?.plan_key}<Badge variant={sub?.status === "active" ? "success" : sub?.status === "trialing" ? "default" : "destructive"}>{(b.status as Record<string, string>)[sub?.status ?? ""] ?? sub?.status}</Badge></CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              {current && current.price_cents > 0 && <p className="text-2xl font-semibold text-foreground">{formatCurrency(current.price_cents, locale)}<span className="text-sm font-normal text-muted-foreground">{b.perMonth}</span></p>}
              {sub?.status === "trialing" && sub.trial_ends_at && <p>{fmt(b.trialEnds, { date: formatDate(sub.trial_ends_at, locale) })}</p>}
              {sub?.status !== "trialing" && sub?.current_period_end && <p>{fmt(b.periodEnds, { date: formatDate(sub.current_period_end, locale) })}</p>}
              {seat && <p>{b.seats}: {seat.used} / {seat.allowed}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{b.usage}</CardTitle></CardHeader>
            <CardContent className="space-y-4 pt-3">
              {credits.map((c) => {
                const pct = c.allowance ? Math.min(100, (c.used / c.allowance) * 100) : 100;
                return (
                  <div key={c.kind}>
                    <div className="flex justify-between text-sm"><span>{(b.kinds as Record<string, string>)[c.kind]}</span><span className="tabular text-muted-foreground">{formatNumber(c.used, locale)} / {formatNumber(c.allowance, locale)}</span></div>
                    <Progress value={pct} className="mt-1.5" indicatorClassName={pct >= 90 ? "bg-destructive" : pct >= 75 ? "bg-warning" : undefined} />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {(plans ?? []).some((p) => p.is_public && p.is_active && p.key !== USAGE_PLAN_KEY) && (
        <section>
          <h2 className="mb-3 text-base font-semibold">{b.plans}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {(plans ?? []).filter((p) => p.is_public && p.is_active && p.key !== USAGE_PLAN_KEY).map((p) => (
              <Card key={p.key} className={p.key === sub?.plan_key ? "border-primary ring-1 ring-primary" : undefined}>
                <CardHeader>
                  <CardTitle>{p.name}</CardTitle>
                  <CardDescription>{p.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-3xl font-semibold tracking-tight">{formatCurrency(p.price_cents, locale)}<span className="text-sm font-normal text-muted-foreground">{b.perMonth}</span></p>
                  <ul className="space-y-1.5 text-sm">
                    {Object.entries(p.limits as Record<string, number>).map(([k, v]) => (
                      <li key={k} className="flex items-center gap-2"><CheckCircle2 className="size-4 text-primary" />{formatNumber(v, locale)} {(b.limits as Record<string, string>)[k] ?? k}</li>
                    ))}
                  </ul>
                  {p.key === sub?.plan_key && sub?.status === "active" ? <Badge variant="success">{b.current}</Badge> : isOwner ? <PlanButton planKey={p.key} label={b.choose} /> : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        )}

        {!usagePlan && (
        <section>
          <h2 className="mb-3 text-base font-semibold">{b.packs}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(packs ?? []).map((p) => (
              <Card key={p.key}>
                <CardContent className="space-y-2">
                  <p className="text-sm font-medium">{formatNumber(p.quantity, locale)} {(b.kinds as Record<string, string>)[p.kind]}</p>
                  <p className="text-xl font-semibold">{formatCurrency(p.price_cents, locale)}</p>
                  {hasMinRole(ws.role, "admin") && <PackButton packKey={p.key} label={b.buy} />}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        )}

        {ws.isPlatformAdmin && <PlanAdmin plans={(plans ?? []) as never} stripeLive={mode === "live"} />}
      </div>
    </>
  );
}

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
import { PlanButton, PackButton, PortalButton, PlanAdmin } from "./billing-client";

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
      <div className="space-y-6">
        {mode !== "live" && <Alert variant="warning"><FlaskConical /><AlertDescription className="text-foreground">{b.demoMode}</AlertDescription></Alert>}
        {sp.checkout === "success" && <Alert variant="success"><CheckCircle2 /><AlertDescription className="text-foreground">{b.checkoutSuccess}</AlertDescription></Alert>}
        {trialExpired && <Alert variant="destructive"><AlertTriangle /><AlertDescription className="text-foreground">{b.trialExpired}</AlertDescription></Alert>}

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

        <section>
          <h2 className="mb-3 text-base font-semibold">{b.plans}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {(plans ?? []).filter((p) => p.is_public && p.is_active).map((p) => (
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

        {ws.isPlatformAdmin && <PlanAdmin plans={(plans ?? []) as never} stripeLive={mode === "live"} />}
      </div>
    </>
  );
}

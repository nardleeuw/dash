import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Inbox, ListTodo, Mail, Search, Wand2 } from "lucide-react";
import { PageHeader, StatCard } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getWorkspace } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { fmt, formatNumber, formatPercent } from "@/i18n/format";
import { getCreditStatus } from "@/server/usage";

export const metadata = { title: "Overzicht" };

export default async function OverviewPage() {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const supabase = await createClient();
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const org = ws.org.id;
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [{ data: summary }, credits, attention, pendingReview, openTasks, profile, orgRow, notices, accounts, businesses, analyses, generated, campaigns] = await Promise.all([
    supabase.rpc("analytics_summary", { p_org: org, p_from: from.toISOString(), p_to: to.toISOString() }),
    getCreditStatus(org),
    count(supabase.from("conversations").select("id", { count: "exact", head: true }).eq("org_id", org).eq("needs_attention", true)),
    count(supabase.from("generated_emails").select("id", { count: "exact", head: true }).eq("org_id", org).eq("generation_status", "completed").eq("review_status", "pending")),
    count(supabase.from("tasks").select("id", { count: "exact", head: true }).eq("org_id", org).eq("status", "open").eq("assignee_id", ws.user.id)),
    supabase.from("agency_profiles").select("services").eq("org_id", org).is("client_id", null).maybeSingle(),
    supabase.from("organizations").select("legal_name, kvk_number, postal_address, privacy_policy_url").eq("id", org).single(),
    count(supabase.from("privacy_notices").select("id", { count: "exact", head: true }).eq("org_id", org).eq("is_active", true)),
    count(supabase.from("email_accounts").select("id", { count: "exact", head: true }).eq("org_id", org)),
    count(supabase.from("businesses").select("id", { count: "exact", head: true }).eq("org_id", org)),
    count(supabase.from("website_analyses").select("id", { count: "exact", head: true }).eq("org_id", org).eq("status", "completed")),
    count(supabase.from("generated_emails").select("id", { count: "exact", head: true }).eq("org_id", org).eq("generation_status", "completed")),
    count(supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("org_id", org).not("launched_at", "is", null)),
  ]);
  const T = (summary as { totals: Record<string, number> }).totals;
  const o = t.overview;
  const locale = t.meta.dateLocale;
  const steps = [
    { key: "profile", done: ((profile.data?.services as unknown[]) ?? []).length > 0, href: "/emails?tab=profile" },
    { key: "identity", done: Boolean(orgRow.data?.legal_name && orgRow.data.kvk_number && orgRow.data.postal_address && (notices > 0 || orgRow.data.privacy_policy_url)), href: "/settings" },
    { key: "mailbox", done: accounts > 0, href: "/integrations" },
    { key: "import", done: businesses > 0, href: "/discover" },
    { key: "research", done: analyses > 0, href: "/leads" },
    { key: "generate", done: generated > 0, href: "/leads" },
    { key: "campaign", done: campaigns > 0, href: "/campaigns" },
  ] as const;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader
        title={fmt(o.welcome, { name: ws.user.fullName?.split(" ")[0] ?? "" })}
        description={fmt(o.subtitle, { org: ws.org.name })}
        actions={
          <>
            <Button variant="outline" asChild><Link href="/discover"><Search />{t.nav.discover}</Link></Button>
            <Button asChild><Link href="/leads"><Wand2 />{t.emails.generate}</Link></Button>
          </>
        }
      />
      <div className="space-y-6">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground uppercase">{o.thisMonth}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label={t.analytics.totals.discovered} value={formatNumber(T.discovered, locale)} />
            <StatCard label={t.analytics.totals.sent} value={formatNumber(T.sent, locale)} />
            <StatCard label={t.analytics.totals.replies} value={formatNumber(T.replies, locale)} hint={T.sent ? `${formatPercent(T.replies / T.sent, locale)} ${t.analytics.rates.reply.toLowerCase()}` : undefined} />
            <StatCard label={t.analytics.totals.positive} value={formatNumber(T.positive, locale)} />
            <StatCard label={t.analytics.totals.meetings} value={formatNumber(T.meetings, locale)} />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>{o.needsAttention}</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-3">
              {[
                { icon: Inbox, label: o.replies, n: attention, href: "/inbox" },
                { icon: Mail, label: o.pendingReview, n: pendingReview, href: "/emails?filter=pending" },
                { icon: ListTodo, label: o.openTasks, n: openTasks, href: "/crm" },
              ].map((x) => (
                <Link key={x.href} href={x.href} className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm hover:bg-muted/50">
                  <span className="flex items-center gap-2"><x.icon className="size-4 text-muted-foreground" />{x.label}</span>
                  <span className="flex items-center gap-2 font-semibold tabular">{x.n}<ArrowRight className="size-3.5 text-muted-foreground" /></span>
                </Link>
              ))}
              {attention + pendingReview + openTasks === 0 && <p className="text-sm text-muted-foreground">{o.noAttention}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{o.setup}</CardTitle>
              <span className="text-sm text-muted-foreground tabular">{doneCount}/{steps.length}</span>
            </CardHeader>
            <CardContent className="space-y-1 pt-3">
              <Progress value={(doneCount / steps.length) * 100} className="mb-3" />
              {steps.map((s) => (
                <Link key={s.key} href={s.href} className="flex items-center gap-2.5 rounded-md px-1 py-1.5 text-sm hover:bg-muted/50">
                  {s.done ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
                  <span className={s.done ? "text-muted-foreground line-through" : ""}>{o.steps[s.key]}</span>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{o.credits}</CardTitle>
              <Link href="/billing" className="text-xs font-medium text-primary hover:underline">{t.nav.billing} →</Link>
            </CardHeader>
            <CardContent className="space-y-3 pt-3">
              {credits.map((c) => (
                <div key={c.kind}>
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">{(t.billing.kinds as Record<string, string>)[c.kind]}</span><span className="tabular">{c.used}/{c.allowance}</span></div>
                  <Progress value={c.allowance ? (c.used / c.allowance) * 100 : 100} className="mt-1" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

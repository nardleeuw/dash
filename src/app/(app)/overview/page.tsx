import Link from "next/link";
import { ArrowRight, AtSign, Building2, CheckCircle2, Circle, Inbox, Mail, MailCheck, Send, Wallet } from "lucide-react";
import { PageHeader, StatCard } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getWorkspace } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { fmt, formatCurrency, formatDate, formatNumber } from "@/i18n/format";
import { monthlySpend, monthStart } from "@/server/usage";
import { senderIdentityComplete } from "@/server/compliance/identity";

export const metadata = { title: "Overzicht" };

const POSITIVE = ["interested", "meeting_request", "more_info"];

/** One-page overview: pipeline numbers, readiness checklist, usage, latest replies and sends. */
export default async function OverviewPage() {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const o = t.overviewPage;
  const supabase = await createClient();
  const org = ws.org.id;
  const locale = t.meta.dateLocale;
  const since = monthStart();
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

  const [
    businesses, withEmail, emailsTotal, emailsReady, sentMonth, sentTotal, repliesMonth, positiveMonth, unsubscribes,
    { data: profile }, { data: orgRow }, mailboxes, spend, { data: latestReplies }, { data: latestSends },
  ] = await Promise.all([
    count(supabase.from("businesses").select("id", { count: "exact", head: true }).eq("org_id", org)),
    count(supabase.from("businesses").select("id, contacts!inner(id)", { count: "exact", head: true }).eq("org_id", org).not("contacts.email", "is", null)),
    count(supabase.from("generated_emails").select("id", { count: "exact", head: true }).eq("org_id", org).eq("sequence_step", 0).eq("generation_status", "completed")),
    count(supabase.from("generated_emails").select("id", { count: "exact", head: true }).eq("org_id", org).eq("sequence_step", 0).eq("generation_status", "completed").neq("review_status", "rejected").not("recipient_email", "is", null)),
    count(supabase.from("outbound_messages").select("id", { count: "exact", head: true }).eq("org_id", org).eq("status", "sent").gte("sent_at", since)),
    count(supabase.from("outbound_messages").select("id", { count: "exact", head: true }).eq("org_id", org).eq("status", "sent")),
    count(supabase.from("replies").select("id", { count: "exact", head: true }).eq("org_id", org).eq("is_auto_reply", false).gte("received_at", since)),
    count(supabase.from("replies").select("id", { count: "exact", head: true }).eq("org_id", org).in("ai_category", POSITIVE).gte("received_at", since)),
    count(supabase.from("suppression_records").select("id", { count: "exact", head: true }).eq("org_id", org).eq("reason", "unsubscribe")),
    supabase.from("agency_profiles").select("services").eq("org_id", org).is("client_id", null).maybeSingle(),
    supabase.from("organizations").select("legal_name, postal_address").eq("id", org).single(),
    count(supabase.from("email_accounts").select("id", { count: "exact", head: true }).eq("org_id", org).eq("status", "active")),
    monthlySpend(org),
    supabase.from("replies").select("id, from_name, from_email, ai_category, ai_summary, received_at, conversation_id").eq("org_id", org).eq("is_auto_reply", false).order("received_at", { ascending: false }).limit(5),
    supabase.from("outbound_messages").select("id, to_email, subject, sent_at").eq("org_id", org).eq("status", "sent").order("sent_at", { ascending: false }).limit(5),
  ]);
  // "Ready" excludes emails already handed to a send run.
  const { count: queued } = await supabase.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("org_id", org).in("status", ["pending", "active"]);

  const steps = [
    { done: ((profile?.services as unknown[]) ?? []).length > 0, label: o.steps.profile, href: "/settings?tab=sender" },
    { done: senderIdentityComplete(orgRow), label: o.steps.company, href: "/settings?tab=organization" },
    { done: mailboxes > 0, label: o.steps.mailbox, href: "/integrations" },
    { done: businesses > 0, label: o.steps.leads, href: "/discover" },
    { done: emailsTotal > 0, label: o.steps.emails, href: "/leads" },
    { done: sentTotal > 0, label: o.steps.send, href: "/emails" },
  ];
  const doneSteps = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const categories = t.inbox.categories as Record<string, string>;
  const replyRate = sentMonth ? Math.round((repliesMonth / sentMonth) * 100) : null;

  return (
    <>
      <PageHeader title={(ws.user.fullName ?? "").trim() ? fmt(o.welcome, { name: (ws.user.fullName ?? "").trim().split(" ")[0] }) : o.welcomePlain} description={o.subtitle} />

      {next && (
        <Card className="mb-6">
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{o.getStarted}</p>
                <p className="text-sm text-muted-foreground">{fmt(o.stepsDone, { done: doneSteps, total: steps.length })}</p>
              </div>
              <Button asChild><Link href={next.href}>{next.label} <ArrowRight /></Link></Button>
            </div>
            <Progress value={(doneSteps / steps.length) * 100} />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {steps.map((s) => (
                <Link key={s.label} href={s.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  {s.done ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
                  <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.label}</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={o.stats.businesses} value={formatNumber(businesses, locale)} hint={fmt(o.stats.withEmail, { count: formatNumber(withEmail, locale) })} icon={Building2} />
        <StatCard label={o.stats.emails} value={formatNumber(emailsTotal, locale)} hint={fmt(o.stats.ready, { count: formatNumber(Math.max(0, emailsReady - (queued ?? 0)), locale) })} icon={Mail} />
        <StatCard label={o.stats.sent} value={formatNumber(sentMonth, locale)} hint={fmt(o.stats.sentTotal, { count: formatNumber(sentTotal, locale), queued: formatNumber(queued ?? 0, locale) })} icon={Send} />
        <StatCard label={o.stats.replies} value={formatNumber(repliesMonth, locale)} hint={fmt(o.stats.repliesHint, { positive: positiveMonth, rate: replyRate ?? "–", unsub: unsubscribes })} icon={Inbox} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Inbox className="size-4" />{o.latestReplies}</CardTitle>
            <Button size="sm" variant="ghost" asChild><Link href="/inbox">{o.toInbox} <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent className="divide-y pt-0">
            {(latestReplies ?? []).length === 0 && <p className="py-3 text-sm text-muted-foreground">{o.noReplies}</p>}
            {(latestReplies ?? []).map((r) => (
              <Link key={r.id} href={r.conversation_id ? `/inbox?c=${r.conversation_id}` : "/inbox"} className="flex items-start justify-between gap-3 py-3 hover:bg-accent/40">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.from_name || r.from_email}</p>
                  <p className="truncate text-sm text-muted-foreground">{r.ai_summary ?? ""}</p>
                </div>
                <div className="shrink-0 text-right">
                  {r.ai_category && <Badge variant={POSITIVE.includes(r.ai_category) ? "success" : "secondary"}>{categories[r.ai_category] ?? r.ai_category}</Badge>}
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(r.received_at, locale, true)}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="size-4" />{o.usage}</CardTitle></CardHeader>
            <CardContent className="space-y-3 pt-0">
              {spend ? (
                <>
                  <p className="text-2xl font-semibold tracking-tight">{formatCurrency(spend.billableCents, locale)}</p>
                  {spend.capCents > 0 && (
                    <div>
                      <Progress value={Math.min(100, (spend.billableCents / spend.capCents) * 100)} />
                      <p className="mt-1 text-xs text-muted-foreground">{fmt(o.cap, { cap: formatCurrency(spend.capCents, locale) })}</p>
                    </div>
                  )}
                </>
              ) : <p className="text-sm text-muted-foreground">{o.noUsagePlan}</p>}
              <Button size="sm" variant="outline" asChild><Link href="/billing">{o.toBilling}</Link></Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><MailCheck className="size-4" />{o.latestSends}</CardTitle></CardHeader>
            <CardContent className="divide-y pt-0">
              {(latestSends ?? []).length === 0 && <p className="py-2 text-sm text-muted-foreground">{o.noSends}</p>}
              {(latestSends ?? []).map((m) => (
                <div key={m.id} className="py-2">
                  <p className="flex items-center gap-1.5 truncate text-sm"><AtSign className="size-3.5 shrink-0 text-muted-foreground" />{m.to_email}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.subject} · {m.sent_at ? formatDate(m.sent_at, locale, true) : ""}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

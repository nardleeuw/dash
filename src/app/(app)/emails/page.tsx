import Link from "next/link";
import { Mail } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { getWorkspace, hasMinRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { EmailList, type EmailItem, type EmailState } from "./email-list";
import type { MailboxOption } from "./send-dialog";

export const metadata = { title: "E-mails" };

const FILTERS = ["all", "ready", "sent"] as const;

export default async function EmailsPage({ searchParams }: PageProps<"/emails">) {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const sp = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(String(sp.filter)) ? String(sp.filter) : "all";
  const e = t.emails;
  const l = e.list;
  const supabase = await createClient();

  const [{ data: rows }, { data: mailboxes }] = await Promise.all([
    supabase
      .from("generated_emails")
      .select("id, subject, recipient_email, generation_status, review_status, fact_check, error, updated_at, businesses(name, city)")
      .eq("org_id", ws.org.id)
      .eq("sequence_step", 0)
      .neq("review_status", "rejected")
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase.from("email_accounts").select("id, email_address, daily_limit, is_mock").eq("org_id", ws.org.id).eq("status", "active").order("created_at"),
  ]);
  const ids = (rows ?? []).map((r) => r.id);
  const { data: recipients } = ids.length
    ? await supabase.from("campaign_recipients").select("generated_email_id, status, stop_reason, updated_at").eq("org_id", ws.org.id).in("generated_email_id", ids)
    : { data: [] };
  const byEmail = new Map<string, { status: string; stop_reason: string | null }>();
  for (const r of recipients ?? []) byEmail.set(r.generated_email_id as string, r);

  const items: EmailItem[] = (rows ?? []).map((r) => {
    const rec = byEmail.get(r.id);
    let state: EmailState;
    let detail: string | null = null;
    if (["queued", "researching", "generating"].includes(r.generation_status)) state = "generating";
    else if (r.generation_status === "failed") { state = "failed"; detail = r.error ? (l.errors as Record<string, string>)[r.error] ?? r.error : null; }
    else if (rec && ["sent", "completed", "replied"].includes(rec.status)) state = "sent";
    else if (rec && ["active", "pending"].includes(rec.status)) state = "scheduled";
    else if (rec && ["stopped", "bounced", "unsubscribed"].includes(rec.status)) { state = "blocked"; detail = (rec.stop_reason ?? "").split(",").filter(Boolean).map((c) => (l.blockReasons as Record<string, string>)[c] ?? c).join(" · ") || null; }
    else if (!r.recipient_email) { state = "no_recipient"; }
    else state = "ready";
    const company = (r.businesses as unknown as { name: string; city: string | null } | null);
    return {
      id: r.id, company: company?.name ?? "—", city: company?.city ?? null, recipient: r.recipient_email, subject: r.subject, state, detail,
      factWarning: (r.fact_check as { passed?: boolean } | null)?.passed === false,
    };
  });
  const shown = filter === "ready" ? items.filter((i) => i.state === "ready") : filter === "sent" ? items.filter((i) => ["scheduled", "sent", "blocked"].includes(i.state)) : items;
  const generating = items.some((i) => i.state === "generating");

  return (
    <>
      <PageHeader title={e.title} description={l.subtitle} />
      {generating && <AutoRefresh intervalMs={4000} />}
      {items.length === 0 ? (
        <EmptyState icon={Mail} title={e.empty} description={l.emptyText} action={<Button asChild><Link href="/leads">{l.toLeads}</Link></Button>} />
      ) : (
        <>
          <div className="mb-4 inline-flex h-9 items-center rounded-lg bg-secondary p-1">
            {FILTERS.map((k) => (
              <Link key={k} href={k === "all" ? "/emails" : `/emails?filter=${k}`} className={`inline-flex h-full items-center rounded-md px-3 text-sm font-medium ${filter === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {(l.filters as Record<string, string>)[k]}
              </Link>
            ))}
          </div>
          <EmailList items={shown} mailboxes={(mailboxes ?? []) as MailboxOption[]} canSend={hasMinRole(ws.role, "manager")} />
        </>
      )}
    </>
  );
}

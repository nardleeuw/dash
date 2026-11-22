import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getWorkspace, hasMinRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/app/page-header";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { CampaignControls, CampaignSettings, AddRecipients, SequenceEditor } from "./campaign-client";

const VARIANT: Record<string, "secondary" | "default" | "success" | "warning" | "outline" | "destructive"> = {
  draft: "secondary", scheduled: "default", running: "success", paused: "warning", completed: "outline", cancelled: "destructive",
  pending: "secondary", active: "default", replied: "success", bounced: "destructive", unsubscribed: "warning", stopped: "outline", failed: "destructive",
};

export default async function CampaignPage({ params }: PageProps<"/campaigns/[id]">) {
  const { id } = await params;
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const supabase = await createClient();
  const { data: c } = await supabase.from("campaigns").select("*").eq("id", id).eq("org_id", ws.org.id).maybeSingle();
  if (!c) notFound();
  const [{ data: recipients }, { data: messages }, { data: accounts }, { data: profiles }, { data: sequences }, { data: batches }, { data: lists }] = await Promise.all([
    supabase.from("campaign_recipients").select("id, email, status, current_step, next_send_at, last_sent_at, stop_reason, business_id, businesses(name)").eq("campaign_id", id).order("created_at").limit(1000),
    supabase.from("outbound_messages").select("id, to_email, subject, status, sequence_step, sent_at, error, is_mock").eq("campaign_id", id).order("created_at", { ascending: false }).limit(200),
    supabase.from("email_accounts").select("id, email_address, status, is_mock").eq("org_id", ws.org.id),
    supabase.from("agency_profiles").select("id, client_id, agency_clients(name)").eq("org_id", ws.org.id),
    supabase.from("follow_up_sequences").select("id, name, steps").eq("org_id", ws.org.id).order("created_at"),
    supabase.from("email_generation_batches").select("id, name, created_at").eq("org_id", ws.org.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("lead_lists").select("id, name").eq("org_id", ws.org.id),
  ]);
  const cc = t.campaigns;
  const r = recipients ?? [];
  const count = (s: string[]) => r.filter((x) => s.includes(x.status)).length;
  const sent = (messages ?? []).filter((m) => ["sent", "delivered"].includes(m.status)).length;
  const editable = ["draft", "paused", "scheduled"].includes(c.status) && ws.role !== "viewer";
  const sequence = (sequences ?? []).find((s) => s.id === c.follow_up_sequence_id) ?? null;
  const awaiting = r.filter((x) => x.stop_reason === "awaiting_approval").length;

  return (
    <div className="space-y-6">
      {c.status === "running" && <AutoRefresh intervalMs={10_000} />}
      <div>
        <Link href="/campaigns" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{cc.title}</Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-tight">{c.name}</h1>
            <Badge variant={VARIANT[c.status]}>{(cc.status as Record<string, string>)[c.status]}</Badge>
          </div>
          {hasMinRole(ws.role, "manager") && <CampaignControls id={c.id} status={c.status} />}
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" />{cc.stopRules} {cc.noRotation}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={cc.stats.recipients} value={r.length} />
        <StatCard label={cc.stats.sent} value={sent} />
        <StatCard label={cc.stats.replied} value={count(["replied"])} />
        <StatCard label={cc.stats.bounced} value={count(["bounced"])} />
        <StatCard label={cc.stats.unsubscribed} value={count(["unsubscribed"])} />
        <StatCard label={cc.stats.stopped} value={count(["stopped", "failed", "cancelled"])} />
      </div>
      {awaiting > 0 && <p className="text-sm text-[oklch(0.55_0.13_65)]">{awaiting} {t.meta.locale === "nl" ? "ontvangers wachten op goedkeuring van hun follow-up." : "recipients are waiting for their follow-up to be approved."} <Link href="/emails?filter=pending" className="font-medium underline">{t.emails.title}</Link></p>}

      <Tabs defaultValue={r.length ? "recipients" : "settings"}>
        <TabsList>
          <TabsTrigger value="recipients">{cc.recipients} ({r.length})</TabsTrigger>
          <TabsTrigger value="settings">{cc.schedule}</TabsTrigger>
          <TabsTrigger value="followups">{cc.sequenceEditor}</TabsTrigger>
          <TabsTrigger value="messages">{cc.messages}</TabsTrigger>
        </TabsList>

        <TabsContent value="recipients" className="space-y-3">
          {ws.role !== "viewer" && !["completed", "cancelled"].includes(c.status) && (
            <AddRecipients id={c.id} batches={(batches ?? []).map((b) => ({ id: b.id, label: b.name ?? formatDate(b.created_at, t.meta.dateLocale, true) }))} lists={lists ?? []} />
          )}
          <Card className="gap-0 overflow-hidden p-0">
            <Table>
              <TableHeader><TableRow><TableHead>{t.emails.columns.company}</TableHead><TableHead>{t.common.email}</TableHead><TableHead>{cc.step}</TableHead><TableHead>{cc.nextSend}</TableHead><TableHead>{t.common.status}</TableHead></TableRow></TableHeader>
              <TableBody>
                {r.map((x) => (
                  <TableRow key={x.id}>
                    <TableCell><Link href={`/leads/${x.business_id}`} className="font-medium hover:text-primary">{(x.businesses as unknown as { name: string } | null)?.name}</Link></TableCell>
                    <TableCell className="text-sm">{x.email}</TableCell>
                    <TableCell className="tabular">{x.current_step}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{x.next_send_at ? formatDate(x.next_send_at, t.meta.dateLocale, true) : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={VARIANT[x.status] ?? "secondary"}>{(cc.recipientStatus as Record<string, string>)[x.status] ?? x.status}</Badge>
                      {x.stop_reason && <div className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground" title={x.stop_reason}>{x.stop_reason}</div>}
                    </TableCell>
                  </TableRow>
                ))}
                {r.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">{cc.addRecipientsHint}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <CampaignSettings
            id={c.id}
            editable={editable}
            initial={{
              name: c.name, email_account_id: c.email_account_id, agency_profile_id: c.agency_profile_id, follow_up_sequence_id: c.follow_up_sequence_id,
              timezone: c.timezone, send_days: c.send_days, send_window_start: c.send_window_start.slice(0, 5), send_window_end: c.send_window_end.slice(0, 5),
              daily_limit: c.daily_limit, starts_at: c.starts_at,
            }}
            accounts={(accounts ?? []).map((a) => ({ id: a.id, label: `${a.email_address}${a.is_mock ? " (demo)" : ""}`, disabled: a.status !== "active" }))}
            profiles={(profiles ?? []).map((p) => ({ id: p.id, label: p.client_id ? (p.agency_clients as unknown as { name: string } | null)?.name ?? "Client" : t.emails.defaultProfile }))}
            sequences={(sequences ?? []).map((s) => ({ id: s.id, label: s.name }))}
          />
        </TabsContent>

        <TabsContent value="followups">
          <SequenceEditor campaignId={c.id} sequence={sequence ? { id: sequence.id, name: sequence.name, steps: sequence.steps as { step: number; delay_days: number; instructions: string | null }[] } : null} canEdit={hasMinRole(ws.role, "manager")} canGenerate={ws.role !== "viewer"} />
        </TabsContent>

        <TabsContent value="messages">
          <Card className="gap-0 overflow-hidden p-0">
            <Table>
              <TableHeader><TableRow><TableHead>{t.common.email}</TableHead><TableHead>{t.emails.columns.subject}</TableHead><TableHead>{cc.step}</TableHead><TableHead>{t.common.status}</TableHead><TableHead>{t.common.created}</TableHead></TableRow></TableHeader>
              <TableBody>
                {(messages ?? []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm">{m.to_email}</TableCell>
                    <TableCell className="max-w-sm truncate text-sm">{m.subject}{m.is_mock && <Badge variant="mock" className="ml-2">{t.mock.label}</Badge>}</TableCell>
                    <TableCell className="tabular">{m.sequence_step}</TableCell>
                    <TableCell><Badge variant={m.status === "sent" || m.status === "delivered" ? "success" : m.status === "bounced" || m.status === "failed" ? "destructive" : "secondary"}>{m.status}</Badge>{m.error && <div className="max-w-xs truncate text-xs text-muted-foreground">{m.error}</div>}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.sent_at ? formatDate(m.sent_at, t.meta.dateLocale, true) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

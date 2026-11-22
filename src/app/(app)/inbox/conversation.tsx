import Link from "next/link";
import { ArrowUpRight, Lightbulb, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWorkspace } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { ConversationActions, ReplyComposer } from "./composer";

export { SyncButton } from "./composer";

export async function ConversationView({ id }: { id: string }) {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const supabase = await createClient();
  const { data: c } = await supabase.from("conversations").select("*, businesses(id, name, city, lead_status), campaigns(id, name)").eq("id", id).eq("org_id", ws.org.id).maybeSingle();
  if (!c) return null;
  const [{ data: replies }, { data: sent }] = await Promise.all([
    supabase.from("replies").select("id, from_email, from_name, subject, body_text, received_at, ai_category, ai_summary, suggested_next_step, matched_by, is_auto_reply").eq("conversation_id", id).order("received_at"),
    c.campaign_recipient_id
      ? supabase.from("outbound_messages").select("id, subject, body_text, sent_at, from_email, sequence_step").eq("campaign_recipient_id", c.campaign_recipient_id).eq("status", "sent").order("sent_at")
      : supabase.from("outbound_messages").select("id, subject, body_text, sent_at, from_email, sequence_step").eq("conversation_id", id).order("sent_at"),
  ]);
  const { data: adhoc } = c.campaign_recipient_id
    ? await supabase.from("outbound_messages").select("id, subject, body_text, sent_at, from_email, sequence_step").eq("conversation_id", id).is("campaign_recipient_id", null).order("sent_at")
    : { data: [] };
  const i = t.inbox;
  const thread = [
    ...[...(sent ?? []), ...(adhoc ?? [])].map((m) => ({ kind: "out" as const, id: m.id, at: m.sent_at as string, who: m.from_email, subject: m.subject, body: m.body_text.split("\n--\n")[0] })),
    ...(replies ?? []).map((r) => ({ kind: "in" as const, id: r.id, at: r.received_at as string, who: r.from_name ? `${r.from_name} <${r.from_email}>` : r.from_email, subject: r.subject, body: r.body_text ?? "", reply: r })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const latest = (replies ?? []).at(-1);
  const biz = c.businesses as unknown as { id: string; name: string; city: string | null; lead_status: string } | null;
  const campaign = c.campaigns as unknown as { id: string; name: string } | null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{c.subject}</h2>
              <p className="text-sm text-muted-foreground">
                {biz && <Link href={`/leads/${biz.id}`} className="inline-flex items-center gap-0.5 hover:text-foreground">{biz.name}<ArrowUpRight className="size-3.5" /></Link>}
                {campaign && <> · <Link href={`/campaigns/${campaign.id}`} className="hover:text-foreground">{campaign.name}</Link></>}
                {" · "}{c.participant_email}
              </p>
            </div>
            <ConversationActions id={c.id} needsAttention={c.needs_attention} status={c.status} category={c.latest_category} canWrite={ws.role !== "viewer"} />
          </div>
          {latest && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Sparkles className="size-3.5" />{i.summary}</p>
                {latest.ai_summary}
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary-soft/40 p-3 text-sm">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary"><Lightbulb className="size-3.5" />{i.nextStep}</p>
                {latest.suggested_next_step}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {thread.map((m) => (
          <div key={m.id} className={cn("rounded-xl border p-4", m.kind === "out" ? "ml-10 bg-muted/30" : "mr-10 bg-background shadow-xs")}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{m.kind === "out" ? i.original : m.who}</span>
              <span className="flex items-center gap-2">
                {m.kind === "in" && m.reply.ai_category && <Badge variant="secondary">{(i.categories as Record<string, string>)[m.reply.ai_category]}</Badge>}
                {m.kind === "in" && <span>{(i.matchedBy as Record<string, string>)[m.reply.matched_by]}</span>}
                {formatDate(m.at, t.meta.dateLocale, true)}
              </span>
            </div>
            <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap">{m.body}</pre>
          </div>
        ))}
      </div>

      {ws.role !== "viewer" && <ReplyComposer conversationId={c.id} />}
    </div>
  );
}

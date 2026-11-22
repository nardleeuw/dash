import Link from "next/link";
import { Inbox } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWorkspace } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { ConversationView, SyncButton } from "./conversation";

export const metadata = { title: "Inbox" };

const CATEGORY_VARIANT: Record<string, "success" | "default" | "warning" | "destructive" | "outline" | "secondary"> = {
  interested: "success", meeting_request: "success", more_info: "default", not_interested: "outline", follow_up_later: "warning",
  out_of_office: "secondary", unsubscribe: "destructive", complaint: "destructive", unknown: "secondary",
};

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const sp = await searchParams;
  const filter = typeof sp.filter === "string" ? sp.filter : "attention";
  const selected = typeof sp.c === "string" ? sp.c : null;
  const supabase = await createClient();
  let q = supabase
    .from("conversations")
    .select("id, subject, participant_email, latest_category, needs_attention, status, last_message_at, businesses(name)")
    .eq("org_id", ws.org.id)
    .order("last_message_at", { ascending: false })
    .limit(200);
  if (filter === "attention") q = q.eq("needs_attention", true).eq("status", "open");
  if (filter === "closed") q = q.eq("status", "closed");
  const { data: conversations } = await q;
  const i = t.inbox;
  const current = selected ?? conversations?.[0]?.id ?? null;

  return (
    <>
      <PageHeader title={i.title} description={i.subtitle} actions={<SyncButton />} />
      <div className="mb-4 flex gap-1.5">
        {(["attention", "all", "closed"] as const).map((f) => (
          <Link key={f} href={`/inbox?filter=${f}`} className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter === f ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground")}>
            {i.filters[f]}
          </Link>
        ))}
      </div>
      {(conversations ?? []).length === 0 ? (
        <EmptyState icon={Inbox} title={i.empty} description={i.emptyText} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <Card className="max-h-[calc(100vh-240px)] gap-0 overflow-y-auto p-0">
            {(conversations ?? []).map((c) => (
              <Link key={c.id} href={`/inbox?filter=${filter}&c=${c.id}`} className={cn("block border-b px-4 py-3 transition-colors hover:bg-muted/50", current === c.id && "bg-primary-soft/50")}>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm", c.needs_attention ? "font-semibold" : "font-medium")}>{(c.businesses as unknown as { name: string } | null)?.name ?? c.participant_email}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(c.last_message_at, t.meta.dateLocale)}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{c.subject}</p>
                {c.latest_category && <Badge variant={CATEGORY_VARIANT[c.latest_category]} className="mt-1.5">{(i.categories as Record<string, string>)[c.latest_category]}</Badge>}
              </Link>
            ))}
          </Card>
          {current ? <ConversationView id={current} /> : <EmptyState title={i.select} />}
        </div>
      )}
    </>
  );
}

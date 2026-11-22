import Link from "next/link";
import { Megaphone } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWorkspace } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { NewCampaignButton } from "./new-campaign";

export const metadata = { title: "Campagnes" };

const STATUS_VARIANT: Record<string, "secondary" | "default" | "success" | "warning" | "outline" | "destructive"> = {
  draft: "secondary", scheduled: "default", running: "success", paused: "warning", completed: "outline", cancelled: "destructive",
};

export default async function CampaignsPage() {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const supabase = await createClient();
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, created_at, launched_at, email_accounts(email_address), campaign_recipients(status)")
    .eq("org_id", ws.org.id)
    .order("created_at", { ascending: false });
  const c = t.campaigns;
  return (
    <>
      <PageHeader title={c.title} description={c.subtitle} actions={ws.role !== "viewer" ? <NewCampaignButton /> : null} />
      {(campaigns ?? []).length === 0 ? (
        <EmptyState icon={Megaphone} title={c.empty} description={c.emptyText} action={ws.role !== "viewer" ? <NewCampaignButton /> : undefined} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(campaigns ?? []).map((x) => {
            const r = (x.campaign_recipients as { status: string }[]) ?? [];
            const count = (s: string[]) => r.filter((y) => s.includes(y.status)).length;
            return (
              <Link key={x.id} href={`/campaigns/${x.id}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{x.name}</p>
                        <p className="text-xs text-muted-foreground">{(x.email_accounts as unknown as { email_address: string } | null)?.email_address ?? "—"} · {formatDate(x.created_at, t.meta.dateLocale)}</p>
                      </div>
                      <Badge variant={STATUS_VARIANT[x.status]}>{(c.status as Record<string, string>)[x.status]}</Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-sm">
                      {[[c.stats.recipients, r.length], [c.stats.sent, count(["active", "completed", "replied"]) ], [c.stats.replied, count(["replied"])], [c.stats.bounced, count(["bounced"])]].map(([l, v]) => (
                        <div key={String(l)}><p className="text-xs text-muted-foreground">{l}</p><p className="font-semibold tabular">{v}</p></div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

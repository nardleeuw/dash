import Link from "next/link";
import { Building2 } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWorkspace, hasMinRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { NewClientButton, ArchiveClientButton } from "./clients-client";

export const metadata = { title: "Klantwerkruimtes" };

export default async function ClientsPage() {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const supabase = await createClient();
  const { data: clients } = await supabase
    .from("agency_clients")
    .select("id, name, website, description, is_archived, lead_lists(id), campaigns(id, campaign_recipients(status)), agency_profiles(id)")
    .eq("org_id", ws.org.id)
    .order("is_archived")
    .order("name");
  const c = t.clients;
  const canManage = hasMinRole(ws.role, "manager");
  return (
    <>
      <PageHeader title={c.title} description={c.subtitle} actions={canManage ? <NewClientButton /> : null} />
      {(clients ?? []).length === 0 ? (
        <EmptyState icon={Building2} title={c.empty} description={c.emptyText} action={canManage ? <NewClientButton /> : undefined} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(clients ?? []).map((x) => {
            const campaigns = (x.campaigns as { campaign_recipients: { status: string }[] }[]) ?? [];
            const recipients = campaigns.flatMap((cp) => cp.campaign_recipients ?? []);
            const profileId = (x.agency_profiles as { id: string }[])?.[0]?.id;
            return (
              <Card key={x.id} className={x.is_archived ? "opacity-60" : undefined}>
                <CardContent className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{x.name}</p>
                      {x.website && <p className="text-xs text-muted-foreground">{x.website}</p>}
                    </div>
                    {x.is_archived && <Badge variant="outline">{c.archive}</Badge>}
                  </div>
                  {x.description && <p className="line-clamp-2 text-sm text-muted-foreground">{x.description}</p>}
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    {[[c.stats.lists, (x.lead_lists as unknown[]).length], [c.stats.campaigns, campaigns.length], [c.stats.sent, recipients.filter((r) => ["active", "completed", "replied"].includes(r.status)).length], [c.stats.replies, recipients.filter((r) => r.status === "replied").length]].map(([l, v]) => (
                      <div key={String(l)}><p className="text-xs text-muted-foreground">{l}</p><p className="font-semibold tabular">{v}</p></div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {profileId && <Link href={`/emails?tab=profile&profile=${profileId}`} className="text-sm font-medium text-primary hover:underline">{c.editProfile} →</Link>}
                    {canManage && <ArchiveClientButton id={x.id} archived={x.is_archived} />}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

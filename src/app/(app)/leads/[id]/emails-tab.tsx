import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { GenerateDialog } from "../generate-button";

export async function ProfileEmailsTrigger() {
  const t = await getDictionary();
  return <TabsTrigger value="emails">{t.leads.profile.emails}</TabsTrigger>;
}

export async function ProfileEmailsTab({ businessId, canWrite = true }: { businessId: string; canWrite?: boolean }) {
  const t = await getDictionary();
  const supabase = await createClient();
  const { data: emails } = await supabase
    .from("generated_emails")
    .select("id, subject, body, sequence_step, generation_status, review_status, compliance_status, recipient_email, updated_at, is_mock")
    .eq("business_id", businessId)
    .order("sequence_step")
    .order("updated_at", { ascending: false });
  return (
    <TabsContent value="emails" className="space-y-4">
      {canWrite && <div className="flex justify-end"><GenerateDialog ids={[businessId]} /></div>}
      {(emails ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t.emails.empty}</p>}
      {(emails ?? []).map((e) => (
        <Card key={e.id}>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/emails/${e.id}`} className="font-medium hover:text-primary">{e.subject ?? (t.emails.genStatus as Record<string, string>)[e.generation_status]}</Link>
              <div className="flex gap-1.5">
                {e.sequence_step > 0 && <Badge variant="secondary">Follow-up {e.sequence_step}</Badge>}
                {e.is_mock && <Badge variant="mock">{t.mock.label}</Badge>}
                <Badge variant={e.review_status === "approved" ? "success" : "warning"}>{(t.emails.reviewStatus as Record<string, string>)[e.review_status]}</Badge>
                {e.compliance_status === "eligible" ? <Badge variant="success"><ShieldCheck />{t.emails.compliance.eligible}</Badge> : e.compliance_status === "blocked" ? <Badge variant="destructive"><ShieldAlert />{t.emails.compliance.blocked}</Badge> : null}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{e.recipient_email ?? t.emails.noRecipient} · {formatDate(e.updated_at, t.meta.dateLocale, true)}</p>
            {e.body && <pre className="line-clamp-4 font-sans text-sm whitespace-pre-wrap text-muted-foreground">{e.body}</pre>}
          </CardContent>
        </Card>
      ))}
    </TabsContent>
  );
}

import Link from "next/link";
import { MailWarning } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { mailErrorCode } from "@/server/sending/mail-errors";

/** Shown on Overview and E-mails when a connected mailbox cannot log in: sending waits until it is fixed. */
export async function MailboxAlert({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("email_accounts").select("email_address, last_error").eq("org_id", orgId).eq("status", "error").limit(1).maybeSingle();
  if (!data) return null;
  const t = await getDictionary();
  const i = t.integrations;
  const reason = (i.mailErrors as Record<string, string>)[mailErrorCode(data.last_error) ?? "other"] ?? i.mailErrors.other;
  return (
    <Alert variant="destructive" className="mb-6">
      <MailWarning />
      <AlertTitle>{i.mailboxBlocked.replace("{email}", data.email_address)}</AlertTitle>
      <AlertDescription className="text-foreground">
        <p>{reason}</p>
        <Button size="sm" className="mt-2" asChild><Link href="/integrations">{i.fixMailbox}</Link></Button>
      </AlertDescription>
    </Alert>
  );
}

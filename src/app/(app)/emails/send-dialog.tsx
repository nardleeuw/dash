"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { sendApprovedAction } from "./actions";

export type MailboxOption = { id: string; email_address: string; daily_limit: number; is_mock: boolean };

/** Send approved emails straight from the Emails page (safe pacing + compliance gate under the hood). */
export function SendDialog({ mailboxes, emailIds, count, label, variant = "default" }: { mailboxes: MailboxOption[]; emailIds?: string[]; count: number; label?: string; variant?: "default" | "outline" }) {
  const t = useT();
  const s = t.emails.send;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mailbox, setMailbox] = useState(mailboxes[0]?.id ?? "");
  const [pending, start] = useTransition();
  const limit = mailboxes.find((m) => m.id === mailbox)?.daily_limit ?? 40;
  const errors: Record<string, string> = { ...(t.common.errors as Record<string, string>), ...(t.campaigns.errors as Record<string, string>), nothing_to_send: s.nothing };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant} disabled={count === 0}><Send />{label ?? s.button}{count > 0 && ` (${count})`}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{s.title}</DialogTitle>
          <DialogDescription>{fmt(s.text, { count, limit })}</DialogDescription>
        </DialogHeader>
        {mailboxes.length === 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span>{s.noMailbox}</span>
            <Button size="sm" variant="outline" asChild><Link href="/integrations">{s.connectMailbox}</Link></Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label>{s.mailbox}</Label>
            <Select value={mailbox} onValueChange={setMailbox}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{mailboxes.map((m) => <SelectItem key={m.id} value={m.id}>{m.email_address}{m.is_mock ? " (demo)" : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button
            disabled={pending || !mailbox}
            onClick={() => start(async () => {
              const r = await sendApprovedAction({ emailIds, allApproved: !emailIds, emailAccountId: mailbox });
              if (!r.ok) {
                toast.error(errors[r.error] ?? t.common.errors.unexpected);
                return;
              }
              const blocked = Object.values(r.data.blocked).reduce((a, b) => a + b, 0);
              const parts = [blocked ? fmt(s.blocked, { count: blocked }) : null, r.data.skipped ? fmt(s.skipped, { count: r.data.skipped }) : null].filter(Boolean).join(" ");
              toast.success(fmt(s.started, { count: r.data.activated }), { description: parts || undefined });
              setOpen(false);
              router.push("/emails?filter=sent");
            })}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Send />}{s.start}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

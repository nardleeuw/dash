"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { regenerateEmailsAction, rejectEmailsAction } from "./actions";
import { SendDialog, type MailboxOption } from "./send-dialog";
import { AdjustDialog } from "./adjust-dialog";

export type EmailState = "generating" | "ready" | "no_recipient" | "scheduled" | "sent" | "blocked" | "failed";
export type EmailItem = {
  id: string;
  company: string;
  city: string | null;
  recipient: string | null;
  subject: string | null;
  state: EmailState;
  detail: string | null;
  factWarning: boolean;
};

const VARIANT: Record<EmailState, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  generating: "secondary", ready: "default", no_recipient: "warning", scheduled: "secondary", sent: "success", blocked: "warning", failed: "destructive",
};

/** Simple list of generated emails: send one, a selection or everything that is ready. */
export function EmailList({ items, mailboxes, canSend }: { items: EmailItem[]; mailboxes: MailboxOption[]; canSend: boolean }) {
  const t = useT();
  const e = t.emails;
  const l = e.list;
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const ready = items.filter((i) => i.state === "ready");
  const selReady = ready.filter((i) => selected.has(i.id)).map((i) => i.id);
  const selIds = [...selected];
  // Only emails that have not been handed to a send run can be rewritten.
  const editable = items.filter((i) => i.state !== "scheduled" && i.state !== "sent" && i.state !== "generating");
  const selEditable = editable.filter((i) => selected.has(i.id)).map((i) => i.id);

  return (
    <div className="space-y-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{selected.size > 0 ? fmt(l.selected, { count: selected.size }) : fmt(l.summary, { total: items.length, ready: ready.length })}</p>
        {canSend && (
          <div className="flex flex-wrap items-center gap-2">
            {selected.size > 0 && (
              <>
                {selEditable.length > 0 && <AdjustDialog emailIds={selEditable} label={l.adjustSelected} onDone={() => setSelected(new Set())} />}
                <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await regenerateEmailsAction(selIds); if (r.ok) toast.success(fmt(e.requeued, { count: r.data.queued })); setSelected(new Set()); router.refresh(); })}><RotateCcw />{l.rewrite}</Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await rejectEmailsAction(selIds, "removed"); setSelected(new Set()); router.refresh(); })}><Trash2 className="text-destructive" />{l.remove}</Button>
                {selReady.length > 0 && <SendDialog mailboxes={mailboxes} emailIds={selReady} count={selReady.length} label={e.send.sendSelected} />}
              </>
            )}
            {selected.size === 0 && editable.length > 0 && <AdjustDialog emailIds={editable.map((i) => i.id)} label={l.adjustAll} />}
            {selected.size === 0 && <SendDialog mailboxes={mailboxes} count={ready.length} label={l.sendAll} />}
            {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
        )}
      </div>
      <Card className="gap-0 overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={items.length > 0 && items.every((i) => selected.has(i.id)) ? true : selected.size ? "indeterminate" : false}
                  onCheckedChange={(c) => setSelected(c ? new Set(items.map((i) => i.id)) : new Set())}
                  aria-label={t.common.selectAll}
                />
              </TableHead>
              <TableHead>{l.company}</TableHead>
              <TableHead>{l.to}</TableHead>
              <TableHead>{l.subject}</TableHead>
              <TableHead>{l.status}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id} data-state={selected.has(i.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox checked={selected.has(i.id)} onCheckedChange={(c) => setSelected((p) => { const n = new Set(p); if (c) n.add(i.id); else n.delete(i.id); return n; })} aria-label={i.company} />
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <span className="block truncate font-medium">{i.company}</span>
                  {i.city && <span className="text-xs text-muted-foreground">{i.city}</span>}
                </TableCell>
                <TableCell className="max-w-[220px] truncate text-sm">{i.recipient ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="max-w-[320px]">
                  {i.subject ? (
                    <Link href={`/emails/${i.id}`} className="block truncate text-sm text-primary hover:underline">{i.subject}</Link>
                  ) : <span className="text-sm text-muted-foreground">…</span>}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <Badge variant={VARIANT[i.state]}>{i.state === "generating" && <Loader2 className="animate-spin" />}{(l.states as Record<EmailState, string>)[i.state]}</Badge>
                    {i.factWarning && <AlertTriangle className="size-4 text-warning" aria-label={l.factWarning} />}
                  </span>
                  {i.detail && <span className="mt-0.5 block max-w-[240px] truncate text-xs text-muted-foreground">{i.detail}</span>}
                </TableCell>
                <TableCell className="text-right">
                  {canSend && i.state === "ready" && <SendDialog mailboxes={mailboxes} emailIds={[i.id]} count={1} label={e.send.button} variant="outline" />}
                  {i.state !== "ready" && i.subject && <Button size="sm" variant="ghost" asChild><Link href={`/emails/${i.id}`}>{l.open}</Link></Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

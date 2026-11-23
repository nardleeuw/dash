"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { regenerateEmailsAction } from "./actions";

/** Rewrite many emails at once with one adjustment ("shorter", "don't mention prices"). */
export function AdjustDialog({ emailIds, label, onDone }: { emailIds: string[]; label: string; onDone?: () => void }) {
  const t = useT();
  const a = t.emails.adjust;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const count = emailIds.length;

  function submit() {
    start(async () => {
      const r = await regenerateEmailsAction(emailIds, text.trim());
      if (!r.ok) {
        toast.error((t.common.errors as Record<string, string>)[r.error] ?? r.error);
        return;
      }
      toast.success(fmt(t.emails.requeued, { count: r.data.queued }));
      setOpen(false);
      setText("");
      onDone?.();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={count === 0}><Wand2 />{label}{count > 0 && ` (${count})`}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{a.title}</DialogTitle>
          <DialogDescription>{fmt(a.text, { count })}</DialogDescription>
        </DialogHeader>
        <Textarea value={text} onChange={(ev) => setText(ev.target.value)} maxLength={800} rows={5} placeholder={a.placeholder} autoFocus />
        <p className="text-xs text-muted-foreground">{a.hint}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button disabled={pending || text.trim().length < 3} onClick={submit}>{pending && <Loader2 className="animate-spin" />}{fmt(a.submit, { count })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

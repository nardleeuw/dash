"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, Check, Loader2, RotateCcw, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/i18n/client";
import { approveEmailsAction, regenerateEmailsAction, rejectEmailsAction, updateEmailAction, applyAlternativeAction } from "../actions";

export function EmailEditor(props: {
  id: string; subject: string; body: string; altSubject: string | null; altBody: string | null; contactId: string | null;
  contacts: { id: string; label: string; verification: string }[]; canWrite: boolean; generationStatus: string; reviewStatus: string;
}) {
  const t = useT();
  const ed = t.emails.editor;
  const router = useRouter();
  const [subject, setSubject] = useState(props.subject);
  const [body, setBody] = useState(props.body);
  const [contactId, setContactId] = useState<string>(props.contactId ?? "none");
  const [instruction, setInstruction] = useState("");
  const [pending, start] = useTransition();
  const dirty = subject !== props.subject || body !== props.body || (props.contactId ?? "none") !== contactId;
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const busy = ["queued", "researching", "generating"].includes(props.generationStatus);

  const handle = (r: { ok: boolean; error?: string }, msg = t.common.saved) => {
    if (r.ok) { toast.success(msg); router.refresh(); }
    else toast.error((t.common.errors as Record<string, string>)[r.error ?? ""] ?? t.common.errors.unexpected);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{ed.recipient}</Label>
            <Select value={contactId} onValueChange={setContactId} disabled={!props.canWrite}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t.emails.noRecipient}</SelectItem>
                {props.contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.label} ({c.verification})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subject">{ed.subject}</Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!props.canWrite || busy} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between"><Label htmlFor="body">{ed.body}</Label><span className="text-xs text-muted-foreground tabular">{words} {ed.words}</span></div>
            <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} disabled={!props.canWrite || busy} rows={16} className="font-[450] leading-relaxed" maxLength={8000} />
            <p className="text-xs text-muted-foreground">{ed.footerNote}</p>
          </div>
          {props.canWrite && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!dirty || pending} onClick={() => start(async () => handle(await updateEmailAction(props.id, { subject, body, contactId: contactId === "none" ? null : contactId })))}>
                <Save />{ed.save}
              </Button>
              <Button disabled={dirty || pending || busy || props.reviewStatus === "approved"} onClick={() => start(async () => handle(await approveEmailsAction([props.id]), t.emails.reviewStatus.approved))}>
                <Check />{t.emails.approve}
              </Button>
              <Button variant="outline" disabled={pending || props.reviewStatus === "rejected"} onClick={() => start(async () => handle(await rejectEmailsAction([props.id], ""), t.emails.reviewStatus.rejected))}>
                <X />{t.emails.reject}
              </Button>
              {pending && <Loader2 className="size-4 animate-spin self-center text-muted-foreground" />}
            </div>
          )}
        </CardContent>
      </Card>

      {props.altBody && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{ed.alternative}</CardTitle>
            {props.canWrite && <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => handle(await applyAlternativeAction(props.id)))}><ArrowLeftRight />{ed.useAlternative}</Button>}
          </CardHeader>
          <CardContent className="pt-3">
            <p className="text-sm font-medium">{props.altSubject}</p>
            <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-muted-foreground">{props.altBody}</pre>
          </CardContent>
        </Card>
      )}

      {props.canWrite && (
        <Card>
          <CardHeader><CardTitle>{ed.regenerateWith}</CardTitle></CardHeader>
          <CardContent className="flex gap-2 pt-3">
            <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t.emails.instructionsPlaceholder} maxLength={800} />
            <Button variant="outline" disabled={pending || busy} onClick={() => start(async () => handle(await regenerateEmailsAction([props.id], instruction), t.emails.genStatus.queued))}>
              <RotateCcw />{t.emails.regenerate}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

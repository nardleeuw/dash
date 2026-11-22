"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, Loader2, RefreshCw, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/i18n/client";
import { draftReplyAction, sendReplyAction, syncInboxAction, updateConversationAction } from "./actions";

export function SyncButton() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(async () => { await syncInboxAction(); toast.success(t.inbox.synced); router.refresh(); })}>
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}{t.inbox.sync}
    </Button>
  );
}

export function ConversationActions({ id, needsAttention, status, category, canWrite }: { id: string; needsAttention: boolean; status: string; category: string | null; canWrite: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canWrite) return null;
  const update = (patch: Record<string, unknown>) => start(async () => { const r = await updateConversationAction(id, patch); if (r.ok) router.refresh(); });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={category ?? "unknown"} onValueChange={(v) => update({ latest_category: v })}>
        <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent>{Object.entries(t.inbox.categories).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
      </Select>
      {needsAttention ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => update({ needs_attention: false })}><CheckCheck />{t.inbox.markHandled}</Button>
      ) : null}
      {status === "open" ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => update({ status: "closed", needs_attention: false })}><X />{t.inbox.close}</Button>
      ) : (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => update({ status: "open" })}><RotateCcw />{t.inbox.reopen}</Button>
      )}
    </div>
  );
}

export function ReplyComposer({ conversationId }: { conversationId: string }) {
  const t = useT();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isDraft, setIsDraft] = useState(false);
  const [pending, start] = useTransition();
  const errors = { ...(t.common.errors as Record<string, string>), ...(t.inbox.errors as Record<string, string>) };
  return (
    <Card>
      <CardContent className="space-y-3">
        <Textarea rows={6} value={body} onChange={(e) => { setBody(e.target.value); }} placeholder={t.inbox.replyPlaceholder} />
        {isDraft && <p className="text-xs text-muted-foreground">{t.inbox.draftNote}</p>}
        <div className="flex gap-2">
          <Button disabled={pending || body.trim().length < 2} onClick={() => start(async () => {
            const r = await sendReplyAction(conversationId, body);
            if (r.ok) { toast.success(t.inbox.sent); setBody(""); setIsDraft(false); router.refresh(); }
            else toast.error(errors[r.error] ?? r.error);
          })}>{pending ? <Loader2 className="animate-spin" /> : <Send />}{t.inbox.send}</Button>
          <Button variant="outline" disabled={pending} onClick={() => start(async () => {
            const r = await draftReplyAction(conversationId);
            if (r.ok) { setBody(r.data.body); setIsDraft(true); }
          })}><Sparkles />{t.inbox.draft}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

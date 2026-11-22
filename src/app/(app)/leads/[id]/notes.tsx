"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/i18n/client";
import { formatDate } from "@/i18n/format";
import { addNoteAction, deleteNoteAction } from "@/app/(app)/crm/actions";

export function Notes({ businessId, notes, canWrite }: { businessId: string; notes: { id: string; body: string; created_at: string; author: string }[]; canWrite: boolean }) {
  const t = useT();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader><CardTitle>{t.crm.notes}</CardTitle></CardHeader>
      <CardContent className="space-y-4 pt-3">
        {canWrite && (
          <div className="space-y-2">
            <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t.crm.notePlaceholder} />
            <Button size="sm" disabled={pending || !body.trim()} onClick={() => start(async () => { const r = await addNoteAction(businessId, body); if (r.ok) { setBody(""); router.refresh(); } })}>{t.crm.addNote}</Button>
          </div>
        )}
        {notes.map((n) => (
          <div key={n.id} className="rounded-lg border p-3">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{n.author} · {formatDate(n.created_at, t.meta.dateLocale, true)}</span>
              {canWrite && <button onClick={() => start(async () => { await deleteNoteAction(n.id, businessId); router.refresh(); })} aria-label={t.common.delete}><Trash2 className="size-3.5 hover:text-destructive" /></button>}
            </div>
            <p className="text-sm whitespace-pre-wrap">{n.body}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

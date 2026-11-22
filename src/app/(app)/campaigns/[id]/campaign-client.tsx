"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2, Pause, Play, Plus, Rocket, Save, Trash2, UserPlus, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { addRecipientsAction, campaignControlAction, generateFollowUpsAction, saveSequenceAction, updateCampaignAction } from "../actions";

type Opt = { id: string; label: string; disabled?: boolean };

function useResult() {
  const t = useT();
  const router = useRouter();
  return (r: { ok: boolean; error?: string }, msg?: string) => {
    if (r.ok) {
      if (msg) toast.success(msg);
      router.refresh();
    } else {
      const map = { ...(t.common.errors as Record<string, string>), ...(t.campaigns.errors as Record<string, string>) };
      toast.error(map[r.error ?? ""] ?? t.common.errors.unexpected);
    }
  };
}

export function CampaignControls({ id, status }: { id: string; status: string }) {
  const t = useT();
  const c = t.campaigns;
  const done = useResult();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const run = (action: "launch" | "pause" | "resume" | "cancel") =>
    start(async () => {
      const r = await campaignControlAction(id, action);
      const msg = r.ok && action === "launch" ? fmt(c.launched, { activated: Number(r.data.activated ?? 0), blocked: JSON.stringify(r.data.blocked ?? {}) }) : undefined;
      done(r, msg ?? t.common.saved);
    });
  return (
    <div className="flex gap-2">
      {status === "draft" && <Button disabled={pending} onClick={() => run("launch")}>{pending ? <Loader2 className="animate-spin" /> : <Rocket />}{c.launch}</Button>}
      {status === "running" && <Button variant="outline" disabled={pending} onClick={() => run("pause")}><Pause />{c.pause}</Button>}
      {status === "paused" && <Button disabled={pending} onClick={() => run("resume")}><Play />{c.resume}</Button>}
      {["draft", "running", "paused", "scheduled"].includes(status) && (
        <Dialog open={confirm} onOpenChange={setConfirm}>
          <DialogTrigger asChild><Button variant="outline" disabled={pending}><Ban className="text-destructive" />{c.cancel}</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{c.cancel}</DialogTitle><DialogDescription>{c.cancelConfirm}</DialogDescription></DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(false)}>{t.common.close}</Button>
              <Button variant="destructive" onClick={() => { setConfirm(false); run("cancel"); }}>{c.cancel}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

type Settings = {
  name: string; email_account_id: string | null; agency_profile_id: string | null; follow_up_sequence_id: string | null; timezone: string;
  send_days: number[]; send_window_start: string; send_window_end: string; daily_limit: number; starts_at: string | null;
};

export function CampaignSettings({ id, editable, initial, accounts, profiles, sequences }: { id: string; editable: boolean; initial: Settings; accounts: Opt[]; profiles: Opt[]; sequences: Opt[] }) {
  const t = useT();
  const c = t.campaigns;
  const done = useResult();
  const [s, setS] = useState<Settings>(initial);
  const [pending, start] = useTransition();
  const select = (k: "email_account_id" | "agency_profile_id" | "follow_up_sequence_id", label: string, opts: Opt[], noneLabel?: string) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={s[k] ?? "none"} onValueChange={(v) => setS({ ...s, [k]: v === "none" ? null : v })} disabled={!editable}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {noneLabel && <SelectItem value="none">{noneLabel}</SelectItem>}
          {opts.map((o) => <SelectItem key={o.id} value={o.id} disabled={o.disabled}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <Card>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5"><Label>{c.name}</Label><Input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} disabled={!editable} /></div>
        {select("email_account_id", c.account, accounts, accounts.length ? undefined : c.noAccount)}
        {select("agency_profile_id", c.profile, profiles)}
        {select("follow_up_sequence_id", c.sequence, sequences, c.noSequence)}
        <div className="space-y-1.5 md:col-span-2">
          <Label>{c.days}</Label>
          <div className="flex flex-wrap gap-1.5">
            {c.weekdays.map((d, i) => {
              const day = i + 1;
              const on = s.send_days.includes(day);
              return (
                <button key={d} type="button" disabled={!editable} onClick={() => setS({ ...s, send_days: on ? s.send_days.filter((x) => x !== day) : [...s.send_days, day].sort() })}
                  className={`h-8 w-11 rounded-md border text-sm font-medium ${on ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground"}`}>{d}</button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>{c.window}</Label><Input type="time" value={s.send_window_start} onChange={(e) => setS({ ...s, send_window_start: e.target.value })} disabled={!editable} /></div>
          <div className="space-y-1.5"><Label>&nbsp;</Label><Input type="time" value={s.send_window_end} onChange={(e) => setS({ ...s, send_window_end: e.target.value })} disabled={!editable} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>{c.dailyLimit}</Label><Input type="number" min={1} max={2000} value={s.daily_limit} onChange={(e) => setS({ ...s, daily_limit: Number(e.target.value) })} disabled={!editable} /></div>
          <div className="space-y-1.5"><Label>{c.startsAt}</Label><Input type="datetime-local" value={s.starts_at ? s.starts_at.slice(0, 16) : ""} onChange={(e) => setS({ ...s, starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} disabled={!editable} /></div>
        </div>
        {editable && (
          <div className="md:col-span-2">
            <Button disabled={pending} onClick={() => start(async () => done(await updateCampaignAction(id, s), t.common.saved))}><Save />{t.common.save}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AddRecipients({ id, batches, lists }: { id: string; batches: Opt[]; lists: { id: string; name: string }[] }) {
  const t = useT();
  const c = t.campaigns;
  const done = useResult();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"approved" | "batch" | "list">("approved");
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><UserPlus />{c.addRecipients}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{c.addRecipients}</DialogTitle><DialogDescription>{c.addRecipientsHint}</DialogDescription></DialogHeader>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={source === "approved"} onChange={() => setSource("approved")} />{t.meta.locale === "nl" ? "Alle goedgekeurde e-mails" : "All approved emails"}</label>
          <label className="flex items-center gap-2"><input type="radio" checked={source === "batch"} onChange={() => setSource("batch")} disabled={!batches.length} />Batch</label>
          {source === "batch" && (
            <Select value={batchId} onValueChange={setBatchId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{batches.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}</SelectContent></Select>
          )}
          <label className="flex items-center gap-2"><input type="radio" checked={source === "list"} onChange={() => setSource("list")} disabled={!lists.length} />{t.leads.list}</label>
          {source === "list" && (
            <Select value={listId} onValueChange={setListId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent></Select>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await addRecipientsAction(id, { source, batchId: source === "batch" ? batchId : undefined, listId: source === "list" ? listId : undefined });
            done(r, r.ok ? fmt(c.added, r.data) : undefined);
            if (r.ok) setOpen(false);
          })}>{pending && <Loader2 className="animate-spin" />}{t.common.add}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Step = { delay_days: number; instructions: string | null };

export function SequenceEditor({ campaignId, sequence, canEdit, canGenerate }: { campaignId: string; sequence: { id: string; name: string; steps: (Step & { step: number })[] } | null; canEdit: boolean; canGenerate: boolean }) {
  const t = useT();
  const c = t.campaigns;
  const done = useResult();
  const [name, setName] = useState(sequence?.name ?? (t.meta.locale === "nl" ? "Standaard follow-up" : "Default follow-up"));
  const [steps, setSteps] = useState<Step[]>(sequence?.steps.map((s) => ({ delay_days: s.delay_days, instructions: s.instructions })) ?? [{ delay_days: 3, instructions: "" }, { delay_days: 7, instructions: "" }]);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{c.sequenceEditor}</CardTitle>
        <CardDescription>{c.stopRules}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5"><Label>{c.sequenceName}</Label><Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} /></div>
        {steps.map((s, i) => (
          <div key={i} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[140px_1fr_auto]">
            <div className="space-y-1.5"><Label>{c.step} {i + 1} · {c.delayDays}</Label><Input type="number" min={1} max={60} value={s.delay_days} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, delay_days: Number(e.target.value) } : x)))} disabled={!canEdit} /></div>
            <div className="space-y-1.5"><Label>{c.stepInstructions}</Label><Textarea rows={2} value={s.instructions ?? ""} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, instructions: e.target.value } : x)))} disabled={!canEdit} /></div>
            {canEdit && <Button variant="ghost" size="icon" className="self-end" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label={t.common.delete}><Trash2 /></Button>}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {canEdit && steps.length < 5 && <Button variant="outline" size="sm" onClick={() => setSteps([...steps, { delay_days: 5, instructions: "" }])}><Plus />{c.addStep}</Button>}
          {canEdit && (
            <Button size="sm" disabled={pending || !steps.length} onClick={() => start(async () => {
              const r = await saveSequenceAction({ id: sequence?.id, name, steps });
              if (r.ok && !sequence) {
                // attach the new sequence to this campaign
                await updateSeq(campaignId, r.data.id);
              }
              done(r, t.common.saved);
            })}><Save />{t.common.save}</Button>
          )}
          {canGenerate && sequence && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
              const r = await generateFollowUpsAction(campaignId);
              done(r, r.ok ? fmt(c.followUpsQueued, r.data) : undefined);
            })}>{pending ? <Loader2 className="animate-spin" /> : <Wand2 />}{c.generateFollowUps}</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

async function updateSeq(campaignId: string, sequenceId: string) {
  const { attachSequenceAction } = await import("./attach-sequence");
  await attachSequenceAction(campaignId, sequenceId);
}

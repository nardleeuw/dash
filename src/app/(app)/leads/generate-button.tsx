"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Mail, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { createBatchAction } from "@/app/(app)/emails/actions";
import { generationContextAction } from "./generation-context";

type ProfileOption = { id: string; label: string; complete: boolean };

/**
 * Dialog to start individual email generation for a selection, the current
 * lead filter, or an entire lead list.
 */
export function GenerateDialog(props: {
  scope: "selection" | "list";
  ids?: string[];
  lists?: { id: string; name: string }[];
  profiles?: ProfileOption[];
  total?: number;
  trigger?: "button" | "bulk";
  onDone?: () => void;
}) {
  const t = useT();
  const e = t.emails;
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileOption[]>(props.profiles ?? []);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [filterTotal, setFilterTotal] = useState<number | null>(null);
  const [profileId, setProfileId] = useState<string>(props.profiles?.[0]?.id ?? "");
  const [scope, setScope] = useState<"selection" | "filter" | "list">(props.scope);
  const [listId, setListId] = useState(props.lists?.[0]?.id ?? "");
  const [mode, setMode] = useState<"missing_only" | "regenerate_all">("missing_only");
  const [instructions, setInstructions] = useState("");
  const [findEmails, setFindEmails] = useState(true);
  const [research, setResearch] = useState(true);
  const [pending, start] = useTransition();
  const filter = Object.fromEntries([...sp.entries()].filter(([k]) => !["page", "sort", "tab"].includes(k)));

  useEffect(() => {
    if (!open) return;
    void generationContextAction(filter).then((ctx) => {
      if (!ctx.ok) return;
      if (!props.profiles?.length) {
        setProfiles(ctx.data.profiles);
        setProfileId((cur) => cur || ctx.data.profiles[0]?.id || "");
      }
      setRemaining(ctx.data.remaining);
      setFilterTotal(ctx.data.filterTotal);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const count = scope === "selection" ? props.ids?.length ?? 0 : scope === "filter" ? Math.min(filterTotal ?? 0, 1000) : null;
  const profile = profiles.find((p) => p.id === profileId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Wand2 />{e.generate}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{e.generateTitle}</DialogTitle>
          <DialogDescription>{e.generateHint}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            {props.scope === "selection" ? (
              <div className="space-y-1.5 text-sm">
                <label className="flex items-center gap-2"><input type="radio" checked={scope === "selection"} onChange={() => setScope("selection")} />{fmt(e.scopeSelected, { count: props.ids?.length ?? 0 })}</label>
                <label className="flex items-center gap-2"><input type="radio" checked={scope === "filter"} onChange={() => setScope("filter")} />{fmt(e.scopeFilter, { count: filterTotal ?? "…" })}</label>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>{e.scopeList}</Label>
                <Select value={listId} onValueChange={setListId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{(props.lists ?? []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{e.profile}</Label>
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{e.mode}</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="missing_only">{e.modeMissing}</SelectItem>
                  <SelectItem value="regenerate_all">{e.modeRegenerate}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <label className="flex items-start justify-between gap-3">
              <span><span className="block text-sm font-medium">{e.optFindEmails}</span><span className="block text-xs text-muted-foreground">{e.optFindEmailsHint}</span></span>
              <Switch checked={findEmails} onCheckedChange={setFindEmails} />
            </label>
            <label className="flex items-start justify-between gap-3">
              <span><span className="block text-sm font-medium">{e.optResearch}</span><span className="block text-xs text-muted-foreground">{e.optResearchHint}</span></span>
              <Switch checked={research} onCheckedChange={setResearch} />
            </label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="instr">{e.instructions}</Label>
            <Textarea id="instr" value={instructions} onChange={(x) => setInstructions(x.target.value)} placeholder={e.instructionsPlaceholder} rows={2} maxLength={800} />
          </div>
          {(!profile || !profile.complete) && (
            <Alert variant="warning">
              <AlertDescription className="col-start-1 flex flex-wrap items-center justify-between gap-3 text-foreground">
                <span>{e.profileMissing}</span>
                <Button size="sm" variant="outline" asChild><Link href="/emails?tab=profile" onClick={() => setOpen(false)}>{e.fillProfile}</Link></Button>
              </AlertDescription>
            </Alert>
          )}
          {count !== null && remaining !== null && (
            <p className="text-xs text-muted-foreground">{fmt(e.estimate, { count, credits: count, remaining })}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button
            disabled={pending || !profileId || !profile?.complete || (scope === "list" && !listId)}
            onClick={() => start(async () => {
              const r = await createBatchAction({ scope, businessIds: props.ids, filter, listId: scope === "list" ? listId : undefined, agencyProfileId: profileId, mode, instructions: instructions || undefined, research, findEmails });
              if (r.ok) {
                toast.success(fmt(e.started, { queued: r.data.queued, skipped: r.data.skipped }));
                setOpen(false);
                props.onDone?.();
                router.push(`/emails?tab=batches`);
              } else toast.error(r.error === "profile_incomplete" ? e.profileMissing : (t.common.errors as Record<string, string>)[r.error] ?? t.common.errors.unexpected);
            })}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Mail />}{e.start}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GenerateEmailsButton({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  return <GenerateDialog scope="selection" ids={ids} trigger="bulk" onDone={onDone} />;
}

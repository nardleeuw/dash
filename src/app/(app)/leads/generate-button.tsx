"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Mail, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { createBatchAction } from "@/app/(app)/emails/actions";
import { generationContextAction } from "./generation-context";

type Profile = { id: string; label: string; complete: boolean; personalization: string; formality: string; email_length: string };
type Level = "none" | "subtle" | "balanced" | "strong";

/** Segmented choice: a row of buttons, one selected. */
function Choice<T extends string>({ label, value, onChange, options, hint }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex rounded-lg border p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn("flex-1 rounded-md px-2 py-1.5 text-sm", value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * "E-mails maken" for the selected businesses: choose personalisation, form
 * of address and length right here; addresses are looked up when missing.
 */
export function GenerateDialog(props: { ids: string[]; onDone?: () => void }) {
  const t = useT();
  const e = t.emails;
  const g = e.dialog;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [level, setLevel] = useState<Level>("subtle");
  const [formality, setFormality] = useState<"formal" | "informal">("formal");
  const [length, setLength] = useState<"short" | "medium" | "long">("short");
  const [findEmails, setFindEmails] = useState(true);
  const [instructions, setInstructions] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    void generationContextAction({}).then((ctx) => {
      if (!ctx.ok) return;
      const p = (ctx.data.profiles.find((x) => x.label === e.defaultProfile) ?? ctx.data.profiles[0]) as Profile | undefined;
      if (p) {
        setProfile(p);
        setLevel((p.personalization as Level) ?? "subtle");
        setFormality(p.formality === "informal" ? "informal" : "formal");
        setLength((p.email_length as "short" | "medium" | "long") ?? "short");
      }
      setRemaining(ctx.data.remaining);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const count = props.ids.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Wand2 />{e.generate}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{fmt(g.title, { count })}</DialogTitle>
          <DialogDescription>{g.subtitle}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Choice
            label={g.personalization}
            value={level}
            onChange={setLevel}
            options={[{ value: "none", label: g.levels.none }, { value: "subtle", label: g.levels.subtle }, { value: "balanced", label: g.levels.balanced }, { value: "strong", label: g.levels.strong }]}
            hint={(g.levelHints as Record<Level, string>)[level]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Choice label={g.formality} value={formality} onChange={setFormality} options={[{ value: "formal", label: "U" }, { value: "informal", label: "Je" }]} />
            <Choice label={g.length} value={length} onChange={setLength} options={[{ value: "short", label: g.lengths.short }, { value: "medium", label: g.lengths.medium }, { value: "long", label: g.lengths.long }]} />
          </div>
          <label className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <span><span className="block text-sm font-medium">{e.optFindEmails}</span><span className="block text-xs text-muted-foreground">{e.optFindEmailsHint}</span></span>
            <Switch checked={findEmails} onCheckedChange={setFindEmails} />
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="instr">{e.instructions}</Label>
            <Textarea id="instr" value={instructions} onChange={(x) => setInstructions(x.target.value)} placeholder={e.instructionsPlaceholder} rows={2} maxLength={800} />
          </div>
          {profile && !profile.complete && (
            <Alert variant="warning">
              <AlertDescription className="col-start-1 flex flex-wrap items-center justify-between gap-3 text-foreground">
                <span>{e.profileMissing}</span>
                <Button size="sm" variant="outline" asChild><Link href="/settings?tab=sender" onClick={() => setOpen(false)}>{e.fillProfile}</Link></Button>
              </AlertDescription>
            </Alert>
          )}
          {remaining !== null && remaining < count && <p className="text-xs text-muted-foreground">{fmt(g.creditsLow, { remaining })}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button
            disabled={pending || !profile?.complete || count === 0}
            onClick={() => start(async () => {
              const r = await createBatchAction({
                scope: "selection", businessIds: props.ids, agencyProfileId: profile!.id, mode: "missing_only",
                instructions: instructions || undefined, personalization: level, formality, email_length: length, findEmails,
              });
              if (r.ok) {
                toast.success(fmt(g.started, { count: r.data.queued }), { description: r.data.skipped ? fmt(g.skipped, { count: r.data.skipped }) : undefined });
                setOpen(false);
                props.onDone?.();
                router.push("/emails");
              } else toast.error(r.error === "profile_incomplete" ? e.profileMissing : (t.common.errors as Record<string, string>)[r.error] ?? t.common.errors.unexpected);
            })}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Mail />}{fmt(g.start, { count })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GenerateEmailsButton({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  return <GenerateDialog ids={ids} onDone={onDone} />;
}

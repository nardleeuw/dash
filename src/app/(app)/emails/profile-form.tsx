"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/i18n/client";
import { saveAgencyProfileAction } from "./actions";

type Profile = {
  id: string; agency_name: string; website: string | null; description: string | null; services: { name: string; description?: string | null }[];
  products: string | null; target_industries: string[]; ideal_customer_profile: string | null; unique_selling_proposition: string | null;
  tone_of_voice: string | null; writing_style: string | null; language: "nl" | "en"; email_length: "short" | "medium" | "long";
  personalization?: "subtle" | "balanced" | "strong"; formality?: "formal" | "informal";
  call_to_action: string | null; example_emails: string[]; avoid_phrases: string[]; sender_name: string | null; sender_title: string | null; signature: string | null;
};

export function ProfileForm({ profile, industries, canEdit }: { profile: Profile; industries: { key: string; label: string }[]; canEdit: boolean }) {
  const t = useT();
  const f = t.emails.profileForm;
  const [p, setP] = useState<Profile>(profile);
  const [examples, setExamples] = useState(profile.example_emails.join("\n---\n"));
  const [avoid, setAvoid] = useState(profile.avoid_phrases.join(", "));
  const [pending, start] = useTransition();
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const text = (k: keyof Profile, label: string, multiline = false, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={String(k)}>{label}</Label>
      {multiline ? (
        <Textarea id={String(k)} value={(p[k] as string) ?? ""} onChange={(e) => set(k, e.target.value as never)} disabled={!canEdit} rows={3} />
      ) : (
        <Input id={String(k)} value={(p[k] as string) ?? ""} onChange={(e) => set(k, e.target.value as never)} disabled={!canEdit} />
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  function save() {
    start(async () => {
      const r = await saveAgencyProfileAction(p.id, {
        ...p,
        services: p.services.filter((s) => s.name.trim()),
        example_emails: examples.split(/^\s*---\s*$/m).map((x) => x.trim()).filter(Boolean).slice(0, 5),
        avoid_phrases: avoid.split(",").map((x) => x.trim()).filter(Boolean),
      });
      if (r.ok) toast.success(t.common.saved);
      else toast.error((t.common.errors as Record<string, string>)[r.error] ?? t.common.errors.unexpected);
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>{f.title}</CardTitle><CardDescription>{f.hint}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {text("agency_name", f.agencyName)}
          {text("website", f.website)}
          {text("description", f.description, true)}
          <div className="space-y-2">
            <Label>{f.services}</Label>
            {p.services.map((s, i) => (
              <div key={i} className="flex gap-2">
                <Input value={s.name} placeholder={f.serviceName} onChange={(e) => set("services", p.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} disabled={!canEdit} className="w-2/5" />
                <Input value={s.description ?? ""} placeholder={f.serviceDescription} onChange={(e) => set("services", p.services.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} disabled={!canEdit} />
                {canEdit && <Button variant="ghost" size="icon" onClick={() => set("services", p.services.filter((_, j) => j !== i))} aria-label={t.common.delete}><Trash2 /></Button>}
              </div>
            ))}
            {canEdit && <Button variant="outline" size="sm" onClick={() => set("services", [...p.services, { name: "", description: "" }])}><Plus />{f.addService}</Button>}
          </div>
          {text("products", f.products, true)}
          {text("ideal_customer_profile", f.icp, true)}
          {text("unique_selling_proposition", f.usp, true)}
          <div className="space-y-2">
            <Label>{f.targetIndustries}</Label>
            <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border p-2">
              {industries.map((i) => (
                <label key={i.key} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={p.target_industries.includes(i.key)} disabled={!canEdit} onCheckedChange={(c) => set("target_industries", c ? [...p.target_industries, i.key] : p.target_industries.filter((x) => x !== i.key))} />
                  {i.label}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t.meta.locale === "nl" ? "Schrijfstijl & afzender" : "Writing style & sender"}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{f.personalization}</Label>
              <Select value={p.personalization ?? "subtle"} onValueChange={(v) => set("personalization", v as NonNullable<Profile["personalization"]>)} disabled={!canEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(f.personalizationLevels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{f.formality}</Label>
              <Select value={p.formality ?? "formal"} onValueChange={(v) => set("formality", v as NonNullable<Profile["formality"]>)} disabled={!canEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(f.formalities).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{f.personalizationHint}</p>
          {text("tone_of_voice", f.tone)}
          {text("writing_style", f.style)}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{f.language}</Label>
              <Select value={p.language} onValueChange={(v) => set("language", v as "nl" | "en")} disabled={!canEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="nl">Nederlands</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{f.length}</Label>
              <Select value={p.email_length} onValueChange={(v) => set("email_length", v as Profile["email_length"])} disabled={!canEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(f.lengths).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {text("call_to_action", f.cta)}
          <div className="space-y-1.5">
            <Label htmlFor="examples">{f.examples}</Label>
            <Textarea id="examples" value={examples} onChange={(e) => setExamples(e.target.value)} rows={6} disabled={!canEdit} />
            <p className="text-xs text-muted-foreground">{f.examplesHint}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="avoid">{f.avoid}</Label>
            <Input id="avoid" value={avoid} onChange={(e) => setAvoid(e.target.value)} disabled={!canEdit} />
            <p className="text-xs text-muted-foreground">{f.avoidHint}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {text("sender_name", f.senderName)}
            {text("sender_title", f.senderTitle)}
          </div>
          {text("signature", f.signature, true, f.signatureHint)}
          {canEdit && (
            <Button onClick={save} disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t.common.save}</Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

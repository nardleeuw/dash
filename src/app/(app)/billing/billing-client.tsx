"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CreditCard, Loader2, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { buyPackAction, choosePlanAction, openPortalAction, savePlanAction, setSpendCapAction, syncStripeAction } from "./actions";
import { Label } from "@/components/ui/label";

function useRun() {
  const t = useT();
  const router = useRouter();
  return (r: { ok: boolean; error?: string; data?: { simulated?: boolean } | null } | undefined) => {
    if (!r) return; // redirected to Stripe
    if (r.ok) { toast.success(r.data?.simulated ? t.billing.simulated : t.common.saved); router.refresh(); }
    else toast.error((t.common.errors as Record<string, string>)[r.error ?? ""] ?? r.error ?? t.common.errors.unexpected);
  };
}

export function PlanButton({ planKey, label }: { planKey: string; label: string }) {
  const run = useRun();
  const [pending, start] = useTransition();
  return <Button className="w-full" disabled={pending} onClick={() => start(async () => run(await choosePlanAction(planKey)))}>{pending && <Loader2 className="animate-spin" />}{label}</Button>;
}

export function PackButton({ packKey, label }: { packKey: string; label: string }) {
  const run = useRun();
  const [pending, start] = useTransition();
  return <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => run(await buyPackAction(packKey)))}>{pending && <Loader2 className="animate-spin" />}{label}</Button>;
}

export function PortalButton() {
  const t = useT();
  const [pending, start] = useTransition();
  return <Button variant="outline" disabled={pending} onClick={() => start(() => openPortalAction())}><CreditCard />{t.billing.manage}</Button>;
}

type Plan = { key: string; name: string; price_cents: number; limits: Record<string, number>; stripe_price_id: string | null; is_public: boolean; is_active: boolean };

export function PlanAdmin({ plans, stripeLive }: { plans: Plan[]; stripeLive: boolean }) {
  const t = useT();
  const a = t.billing.admin;
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{a.title}</CardTitle>
        {stripeLive && <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
          const r = await syncStripeAction();
          if (r.ok) { toast.success(fmt(a.synced, { plans: r.data.plans.join(", ") || "—" })); router.refresh(); } else toast.error(r.error);
        })}><RefreshCw />{a.sync}</Button>}
      </CardHeader>
      <CardContent className="space-y-4">
        {plans.map((p) => <PlanRow key={p.key} plan={p} />)}
      </CardContent>
    </Card>
  );
}

function PlanRow({ plan }: { plan: Plan }) {
  const t = useT();
  const a = t.billing.admin;
  const router = useRouter();
  const [p, setP] = useState(plan);
  const [limits, setLimits] = useState(JSON.stringify(plan.limits));
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_140px_2fr_1fr_auto]">
      <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} aria-label="name" />
      <Input type="number" value={p.price_cents} onChange={(e) => setP({ ...p, price_cents: Number(e.target.value) })} aria-label={a.price} />
      <Textarea rows={2} className="font-mono text-xs" value={limits} onChange={(e) => setLimits(e.target.value)} aria-label={a.limits} />
      <div className="space-y-2">
        <Input placeholder={a.priceId} value={p.stripe_price_id ?? ""} onChange={(e) => setP({ ...p, stripe_price_id: e.target.value || null })} />
        <label className="flex items-center gap-2 text-xs"><Switch checked={p.is_public} onCheckedChange={(v) => setP({ ...p, is_public: v })} />public</label>
      </div>
      <Button size="sm" disabled={pending} onClick={() => start(async () => {
        let parsed: Record<string, number>;
        try { parsed = JSON.parse(limits); } catch { toast.error(t.common.errors.validation); return; }
        const r = await savePlanAction({ ...p, limits: parsed });
        if (r.ok) { toast.success(t.common.saved); router.refresh(); } else toast.error(t.common.errors.validation);
      })}><Save />{t.common.save}</Button>
    </div>
  );
}

export function SpendCapForm({ capCents }: { capCents: number }) {
  const t = useT();
  const run = useRun();
  const [value, setValue] = useState(String(Math.round(capCents / 100)));
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => run(await setSpendCapAction(Number(value)))); }}>
      <div className="space-y-1.5">
        <Label htmlFor="cap">{t.billing.spendCapLabel}</Label>
        <Input id="cap" type="number" min={0} max={100000} step={10} value={value} onChange={(e) => setValue(e.target.value)} className="w-36" />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t.common.save}</Button>
    </form>
  );
}

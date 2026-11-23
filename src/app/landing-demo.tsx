"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, AtSign, Check, Globe, Lock, MessageSquareReply, Search, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type DemoPlan = { key: string; name: string; price: string; description: string; highlight: boolean; href: string };

const STEPS = [
  { key: "find", icon: Search, title: "Bedrijven vinden", action: "Importeer 312 bedrijven" },
  { key: "emails", icon: AtSign, title: "E-mailadressen", action: "Zoek adressen voor alle 312" },
  { key: "write", icon: Sparkles, title: "AI-onderzoek & e-mail", action: "Maak 312 persoonlijke e-mails" },
  { key: "send", icon: Send, title: "Versturen & reacties", action: "Start campagne" },
] as const;

const COMPANIES = [
  { name: "Kapsalon De Schaar", city: "Utrecht", site: "deschaar-utrecht.nl", rating: "4,8" },
  { name: "Hairstudio Noor", city: "Utrecht", site: "hairstudionoor.nl", rating: "4,9" },
  { name: "Barbershop Oudegracht", city: "Utrecht", site: "barberoudegracht.nl", rating: "4,7" },
  { name: "Salon Lokaal", city: "Utrecht", site: "salonlokaal.nl", rating: "4,6" },
  { name: "Knipkamer Lombok", city: "Utrecht", site: "knipkamer.nl", rating: "4,9" },
  { name: "Studio Krul", city: "Utrecht", site: "studiokrul.nl", rating: "4,5" },
];

const EMAILS = [
  { company: "Kapsalon De Schaar", email: "info@deschaar-utrecht.nl", sources: ["Website", "Hunter"] },
  { company: "Hairstudio Noor", email: "noor@hairstudionoor.nl", sources: ["Hunter", "Op naam"], person: "Noor Bakker · eigenaar" },
  { company: "Barbershop Oudegracht", email: "hallo@barberoudegracht.nl", sources: ["Website"] },
  { company: "Salon Lokaal", email: "salonlokaal@gmail.com", sources: ["Internet", "gecontroleerd"] },
  { company: "Knipkamer Lombok", email: "afspraak@knipkamer.nl", sources: ["Website", "Internet"] },
];

/** Interactive product demo for the landing page. Nothing here calls the app: every action leads to the plans. */
export function LandingDemo({ plans }: { plans: DemoPlan[] }) {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const [paywall, setPaywall] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!auto || paywall) return;
    const id = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), 7000);
    return () => clearTimeout(id);
  }, [step, auto, paywall]);

  useEffect(() => {
    if (step !== 0) return;
    let c = 0;
    const id = setInterval(() => {
      c = Math.min(312, c + 13);
      setCount(c);
      if (c >= 312) clearInterval(id);
    }, 40);
    return () => clearInterval(id);
  }, [step]);

  const choose = (i: number) => {
    setAuto(false);
    setStep(i);
  };

  return (
    <div className="relative">
      {/* step selector */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => choose(i)}
            className={cn(
              "group relative flex items-center gap-2.5 overflow-hidden rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
              i === step ? "border-primary bg-primary-soft text-foreground" : "bg-background text-muted-foreground hover:bg-accent",
            )}
          >
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold", i === step ? "bg-primary text-primary-foreground" : "bg-secondary")}>{i + 1}</span>
            <span className="font-medium">{s.title}</span>
            {i === step && auto && <span className="absolute bottom-0 left-0 h-0.5 animate-[demo-progress_7s_linear] bg-primary" />}
          </button>
        ))}
      </div>

      {/* app window */}
      <div className="overflow-hidden rounded-2xl border bg-background shadow-[0_24px_60px_-20px_rgba(16,24,40,0.25)]">
        <div className="flex items-center gap-2 border-b bg-secondary/60 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" /><span className="size-2.5 rounded-full bg-[#febc2e]" /><span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-xs text-muted-foreground">Voorbeeld · {STEPS[step].title}</span>
        </div>
        <div className="min-h-[380px] p-5 sm:p-6">
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-lg border px-3 py-1.5">Branche: <b>Kappers & barbiers</b></span>
                <span className="rounded-lg border px-3 py-1.5">Plaats: <b>Utrecht</b> + 7 km</span>
                <span className="ml-auto text-sm font-medium">{count} bedrijven gevonden</span>
              </div>
              <div className="divide-y rounded-xl border">
                {COMPANIES.map((c, i) => (
                  <div key={c.name} className="flex items-center gap-3 px-4 py-2.5 text-sm" style={{ animation: `demo-in .4s ${i * 0.07}s both` }}>
                    <span className="flex size-4 items-center justify-center rounded border bg-primary text-primary-foreground"><Check className="size-3" /></span>
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    <span className="hidden text-muted-foreground sm:inline">{c.city}</span>
                    <span className="hidden items-center gap-1 text-primary md:flex"><Globe className="size-3.5" />{c.site}</span>
                    <span className="text-xs text-muted-foreground">★ {c.rating}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Per bedrijf zoeken we op de website, bij Hunter en op internet. Elk adres krijgt zijn bron mee — niets wordt verzonnen.</p>
              <div className="divide-y rounded-xl border">
                {EMAILS.map((e, i) => (
                  <div key={e.email} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm" style={{ animation: `demo-in .4s ${i * 0.08}s both` }}>
                    <span className="w-44 shrink-0 truncate font-medium">{e.company}</span>
                    <span className="flex min-w-0 items-center gap-1.5"><AtSign className="size-3.5 text-muted-foreground" />{e.email}</span>
                    {e.person && <span className="text-xs text-muted-foreground">{e.person}</span>}
                    <span className="ml-auto flex gap-1">{e.sources.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
              <div className="space-y-2 rounded-xl border p-4">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">AI-onderzoek · Hairstudio Noor</p>
                {["Afspraken alleen telefonisch of via WhatsApp", "“Bel ons voor een afspraak” op de homepage", "Geen online prijslijst voor kleuringen", "Website niet geoptimaliseerd voor mobiel"].map((o, i) => (
                  <p key={o} className="flex gap-2 text-sm" style={{ animation: `demo-in .4s ${i * 0.1}s both` }}><Check className="mt-0.5 size-4 shrink-0 text-primary" />{o}</p>
                ))}
              </div>
              <div className="rounded-xl border p-4 text-sm leading-relaxed" style={{ animation: "demo-in .5s .2s both" }}>
                <p className="text-xs text-muted-foreground">Aan: noor@hairstudionoor.nl</p>
                <p className="mt-1 font-semibold">Afspraken zonder telefoontjes</p>
                <p className="mt-3">Hoi Noor,</p>
                <p className="mt-2">Op jullie homepage staat “Bel ons voor een afspraak” — tussen het knippen door is dat vast niet altijd handig. Wij bouwen voor salons een online agenda waarin klanten zelf een tijd kiezen, gekoppeld aan jullie eigen rooster.</p>
                <p className="mt-2">Zal ik je in tien minuten laten zien hoe dat er voor Hairstudio Noor uit zou zien?</p>
                <p className="mt-3 text-muted-foreground">Groet, Daan — Studio Pixel</p>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[["Verstuurd", "312"], ["Reacties", "41"], ["Positief", "17"], ["Afspraken", "9"]].map(([k, v], i) => (
                  <div key={k} className="rounded-xl border p-4" style={{ animation: `demo-in .4s ${i * 0.08}s both` }}>
                    <p className="text-xs text-muted-foreground">{k}</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight">{v}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 rounded-xl border p-4 text-sm" style={{ animation: "demo-in .5s .3s both" }}>
                <MessageSquareReply className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="font-medium">Noor Bakker <span className="font-normal text-muted-foreground">· Hairstudio Noor · zojuist</span></p>
                  <p className="mt-1">“Leuk dat je naar onze site hebt gekeken! Donderdagmiddag past goed, bel maar.”</p>
                  <Badge variant="success" className="mt-2">Interesse · AI-label</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Elke e-mail wordt apart verstuurd vanaf je eigen mailbox, binnen veilige limieten, met afmeldlink en compliance-controle.</p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-secondary/40 px-5 py-3">
          <span className="text-xs text-muted-foreground">Voorbeelddata — in jouw account werk je met echte bedrijven.</span>
          <Button size="sm" onClick={() => { setAuto(false); setPaywall(true); }}>
            <Lock />{STEPS[step].action}
          </Button>
        </div>
      </div>

      {/* paywall */}
      {paywall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={() => setPaywall(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="paywall-title" className="w-full max-w-3xl rounded-2xl border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="paywall-title" className="text-xl font-semibold tracking-tight">Klaar om dit voor jouw agency te doen?</h3>
                <p className="mt-1 text-sm text-muted-foreground">Kies een abonnement en je zoekt vandaag nog je eerste bedrijven. Maandelijks opzegbaar.</p>
              </div>
              <button type="button" onClick={() => setPaywall(false)} aria-label="Sluiten" className="rounded-md p-1 text-muted-foreground hover:bg-accent"><X className="size-5" /></button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {plans.map((p) => (
                <div key={p.key} className={cn("flex flex-col rounded-xl border p-4", p.highlight && "border-primary ring-1 ring-primary")}>
                  <p className="font-semibold">{p.name}</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">{p.price}<span className="text-sm font-normal text-muted-foreground"> /maand</span></p>
                  <p className="mt-1 flex-1 text-xs text-muted-foreground">{p.description}</p>
                  <Button className="mt-4" variant={p.highlight ? "default" : "outline"} asChild>
                    <Link href={p.href}>Kies {p.name} <ArrowRight /></Link>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

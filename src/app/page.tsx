import Link from "next/link";
import { ArrowRight, AtSign, CheckCircle2, MailCheck, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/server/auth";
import { createAdminClient } from "@/server/supabase/admin";
import { formatCurrency, formatNumber } from "@/i18n/format";
import { LandingDemo, type DemoPlan } from "./landing-demo";
import { USAGE_PLAN_KEY, billable } from "@/config/billing";

/** Example customer prices per action: estimated provider cost (cents) × (1 + markup). */
function examplePrices() {
  const p = (lo: number, hi?: number) => {
    const a = billable(lo) / 100;
    const b = hi != null ? billable(hi) / 100 : null;
    const f = (x: number) => x.toLocaleString("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
    return b ? `${f(a)} – ${f(b)}` : f(a);
  };
  return [
    ["Bedrijven zoeken (per 20 resultaten)", p(3.2)],
    ["Bedrijf importeren", p(1.7)],
    ["E-mailadres zoeken", p(3, 12)],
    ["AI-onderzoek van een website", p(1, 2)],
    ["Persoonlijke e-mail schrijven", p(3, 5)],
    ["E-mail versturen", "gratis"],
  ];
}

export const metadata = { title: "Leadwerk — vind bedrijven, vind hun e-mail, mail elk bedrijf persoonlijk" };

type PlanRow = { key: string; name: string; description: string | null; price_cents: number; limits: Record<string, number>; sort_order: number };

const FALLBACK_PLANS: PlanRow[] = [
  { key: "starter", name: "Starter", description: "Voor freelancers en kleine agencies", price_cents: 4900, limits: { search: 1000, enrichment: 250, research: 150, email_generation: 150, send: 500 }, sort_order: 1 },
  { key: "growth", name: "Growth", description: "Voor groeiende agencies", price_cents: 9900, limits: { search: 3000, enrichment: 750, research: 500, email_generation: 500, send: 2000 }, sort_order: 2 },
  { key: "pro", name: "Pro", description: "Voor teams met meerdere klanten", price_cents: 19900, limits: { search: 10000, enrichment: 2500, research: 1500, email_generation: 1500, send: 6000 }, sort_order: 3 },
];

/** Public plan list (prices are public information; read with the service client because the page is public). */
async function publicPlans(): Promise<PlanRow[]> {
  try {
    const { data } = await createAdminClient().from("plans").select("key, name, description, price_cents, limits, sort_order").eq("is_public", true).eq("is_active", true).order("sort_order");
    return data?.length ? (data as PlanRow[]) : FALLBACK_PLANS;
  } catch {
    return FALLBACK_PLANS;
  }
}

const LIMIT_LABEL: [string, string][] = [
  ["enrichment", "bedrijven importeren & adressen zoeken"],
  ["email_generation", "persoonlijke e-mails"],
  ["research", "AI-onderzoeken van websites"],
  ["send", "e-mails versturen"],
];

export default async function LandingPage() {
  const [user, plans] = await Promise.all([getCurrentUser(), publicPlans()]);
  const highlight = plans[Math.min(1, plans.length - 1)]?.key;
  const planHref = (key: string) => (user ? `/billing?plan=${key}` : `/signup?plan=${key}`);
  const usage = plans.find((p) => p.key === USAGE_PLAN_KEY);
  const demoPlans: DemoPlan[] = (usage ? [usage] : plans).map((p) => ({
    key: p.key, name: p.name, price: formatCurrency(p.price_cents, "nl"), suffix: p.key === USAGE_PLAN_KEY ? "eenmalig, daarna op verbruik" : "/maand",
    description: p.description ?? "", highlight: true, href: planHref(p.key),
  }));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#demo" className="hover:text-foreground">Zo werkt het</a>
            <a href="#prijzen" className="hover:text-foreground">Prijzen</a>
            <a href="#vragen" className="hover:text-foreground">Vragen</a>
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <Button asChild><Link href="/overview">Naar je account <ArrowRight /></Link></Button>
            ) : (
              <>
                <Button variant="ghost" asChild><Link href="/login">Inloggen</Link></Button>
                <Button className="hidden sm:inline-flex" asChild><a href="#prijzen">Kies je abonnement</a></Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_60%_at_50%_0%,oklch(0.93_0.05_262/.85),transparent)]" />
        <div className="relative mx-auto max-w-4xl px-6 pt-16 pb-12 text-center sm:pt-20">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
            <Sparkles className="size-3.5 text-primary" /> Voor AI-, web-, automatiserings- en marketingagencies
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
            Vind honderden klanten. Mail elk bedrijf alsof je het kent.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground text-balance">
            Zoek bedrijven per branche en plaats, vind automatisch hun e-mailadres en verstuur voor elk bedrijf een eigen e-mail, gebaseerd op wat er écht op hun website staat.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild><a href="#prijzen">Kies je abonnement <ArrowRight /></a></Button>
            <Button size="lg" variant="outline" asChild><a href="#demo">Bekijk hoe het werkt</a></Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{usage ? `${formatCurrency(usage.price_cents, "nl")} eenmalig · daarna alleen wat je gebruikt · gemaakt voor Nederland` : `Vanaf ${formatCurrency(plans[0]?.price_cents ?? 4900, "nl")} per maand · maandelijks opzegbaar`}</p>
        </div>
      </section>

      {/* demo */}
      <section id="demo" className="mx-auto max-w-6xl scroll-mt-24 px-6 pb-24">
        <LandingDemo plans={demoPlans} />
      </section>

      {/* how it works */}
      <section className="border-y bg-secondary/40">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-20 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Search, title: "1. Vind bedrijven", text: "97 branches, elke plaats of straal. We doorzoeken het hele gebied: geen 20 resultaten, maar honderden." },
            { icon: AtSign, title: "2. Vind hun e-mail", text: "Website, Hunter en internet. Elk adres met bron; wat we niet kunnen controleren, nemen we niet over." },
            { icon: Sparkles, title: "3. Eén e-mail per bedrijf", text: "AI leest de website en schrijft een mail over hún situatie. Geen sjabloon met een naam erin." },
            { icon: MailCheck, title: "4. Verstuur & volg op", text: "Vanaf je eigen mailbox, binnen veilige limieten. Reacties komen binnen in één inbox, met AI-labels." },
          ].map((f) => (
            <div key={f.title}>
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary-soft"><f.icon className="size-5 text-primary" /></div>
              <p className="mt-4 font-semibold">{f.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* pricing */}
      {usage ? (
        <section id="prijzen" className="mx-auto max-w-5xl scroll-mt-24 px-6 py-24">
          <div className="text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Eén keer starten, daarna betaal je wat je gebruikt</h2>
            <p className="mt-3 text-muted-foreground">Geen vast pakket waar je te veel of te weinig in zit. Rustige maand? Dan betaal je weinig.</p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-[1fr_1.15fr]">
            <div className="flex flex-col rounded-2xl border border-primary bg-background p-7 shadow-[0_20px_50px_-20px_rgba(37,99,235,0.35)] ring-1 ring-primary">
              <p className="text-lg font-semibold">{usage.name}</p>
              <p className="mt-5 text-5xl font-semibold tracking-tight">{formatCurrency(usage.price_cents, "nl")}</p>
              <p className="mt-1 text-sm text-muted-foreground">eenmalig starttarief, daarna maandelijks je verbruik</p>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {["Alle functies, geen limiet op gebruikers", "Zoeken in heel Nederland, 97 branches", "E-mailadressen zoeken met bronvermelding", "Persoonlijke AI-e-mails per bedrijf", "Versturen vanaf je eigen mailbox", "Maandplafond dat je zelf instelt"].map((x) => (
                  <li key={x} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />{x}</li>
                ))}
              </ul>
              <Button className="mt-7" size="lg" asChild><Link href={planHref(usage.key)}>Nu starten <ArrowRight /></Link></Button>
            </div>
            <div className="rounded-2xl border bg-background p-7">
              <p className="text-lg font-semibold">Wat kost gebruik?</p>
              <p className="mt-1 text-sm text-muted-foreground">Indicatie per actie. Je ziet je verbruik altijd live in je account en betaalt maandelijks achteraf.</p>
              <div className="mt-5 divide-y rounded-xl border text-sm">
                {examplePrices().map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 px-4 py-2.5"><span>{k}</span><span className="tabular font-medium">{v}</span></div>
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">Voorbeeld: 100 bedrijven zoeken, importeren, adres vinden en een persoonlijke e-mail sturen kost ongeveer {formatCurrency(billable(100 * 12) , "nl")}. Prijzen excl. btw.</p>
            </div>
          </div>
          <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4" />Veilig betalen via Stripe · maandplafond in eigen hand · maandelijks opzegbaar</p>
        </section>
      ) : (
      <section id="prijzen" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Eén nieuwe klant betaalt je abonnement terug</h2>
          <p className="mt-3 text-muted-foreground">Kies een plan, rond de betaling af en begin direct. Maandelijks opzegbaar.</p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {plans.map((p) => {
            const top = p.key === highlight;
            return (
              <div key={p.key} className={`relative flex flex-col rounded-2xl border bg-background p-6 ${top ? "border-primary shadow-[0_20px_50px_-20px_rgba(37,99,235,0.35)] ring-1 ring-primary" : ""}`}>
                {top && <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">Meest gekozen</span>}
                <p className="text-lg font-semibold">{p.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                <p className="mt-5 text-4xl font-semibold tracking-tight">{formatCurrency(p.price_cents, "nl")}<span className="text-base font-normal text-muted-foreground"> /maand</span></p>
                <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                  {LIMIT_LABEL.filter(([k]) => p.limits[k] != null).map(([k, label]) => (
                    <li key={k} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />{formatNumber(p.limits[k], "nl")} {label} per maand</li>
                  ))}
                  {p.limits.users != null && <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />{p.limits.users} {p.limits.users === 1 ? "gebruiker" : "gebruikers"}</li>}
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />Zoeken in heel Nederland, 97 branches</li>
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />Afmeldlink, suppressielijst en bronvermelding</li>
                </ul>
                <Button className="mt-7" size="lg" variant={top ? "default" : "outline"} asChild>
                  <Link href={planHref(p.key)}>Start met {p.name} <ArrowRight /></Link>
                </Button>
              </div>
            );
          })}
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4" />Veilig betalen · prijzen excl. btw · je zit nergens aan vast</p>
      </section>

      )}

      {/* faq */}
      <section id="vragen" className="scroll-mt-24 border-t bg-secondary/40">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="text-center text-3xl font-semibold tracking-tight">Veelgestelde vragen</h2>
          <div className="mt-10 divide-y rounded-2xl border bg-background">
            {[
              ["Waar komen de bedrijven vandaan?", "Uit Google Maps-gegevens, aangevuld met OpenStreetMap. We doorzoeken het hele gebied dat je kiest, per branche."],
              ["Hoe komen jullie aan de e-mailadressen?", "We lezen de website van het bedrijf, vragen Hunter en zoeken op internet. Elk adres krijgt zijn bron; wat we niet kunnen controleren, nemen we niet over."],
              ["Is elke e-mail echt anders?", "Ja. De AI leest per bedrijf de website en verwijst naar concrete dingen die daar staan. Jij keurt elke e-mail goed voordat hij de deur uitgaat."],
              ["Mag dit wel, zakelijk mailen?", "Zakelijke e-mail aan bedrijven is onder voorwaarden toegestaan. De software helpt met een verzendcontrole, afmeldlink en suppressielijst. Twijfel je over jouw situatie? Vraag juridisch advies."],
              ["Hoe werkt de prijs?", "Je betaalt één keer het starttarief. Daarna betaal je elke maand achteraf alleen voor wat je hebt gebruikt: zoeken, adressen vinden, onderzoek en e-mails schrijven. Je stelt zelf een maandplafond in."],
              ["Kan ik opzeggen?", "Ja, maandelijks. Je zit nergens aan vast."],
            ].map(([q, a]) => (
              <details key={q} className="px-5 py-4">
                <summary className="cursor-pointer font-medium">{q}</summary>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Button size="lg" asChild><a href="#prijzen">Kies je abonnement <ArrowRight /></a></Button>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs text-muted-foreground">
        <Logo />
        <span>© {new Date().getFullYear()} Leadwerk</span>
      </footer>
    </div>
  );
}

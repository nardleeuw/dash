import Link from "next/link";
import { ArrowRight, Building2, MailCheck, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getDictionary } from "@/i18n/server";
import { getCurrentUser } from "@/server/auth";

export default async function LandingPage() {
  const [t, user] = await Promise.all([getDictionary(), getCurrentUser()]);
  const nl = t.meta.locale === "nl";
  const features = [
    { icon: Search, title: nl ? "Bedrijven vinden" : "Find businesses", text: nl ? "Zoek in heel Nederland op branche, SBI-code, provincie, gemeente of straal — met KVK, Google Places en OpenStreetMap." : "Search the Netherlands by industry, SBI code, province, municipality or radius — with KVK, Google Places and OpenStreetMap." },
    { icon: Sparkles, title: nl ? "Onderzoek per bedrijf" : "Per-business research", text: nl ? "AI analyseert elke website afzonderlijk en scheidt geverifieerde observaties van hypotheses." : "AI analyses each website individually and separates verified observations from hypotheses." },
    { icon: MailCheck, title: nl ? "Eén e-mail per bedrijf" : "One email per business", text: nl ? "Geen sjabloon met een naam erin: elke e-mail is apart onderzocht, geschreven en gecontroleerd op feiten." : "No template with a name pasted in: every email is separately researched, written and fact-checked." },
    { icon: ShieldCheck, title: nl ? "Compliance ingebouwd" : "Compliance built in", text: nl ? "Harde verzendpoort met grondslag, bewijs, suppressielijst en afmelden — afgestemd op AVG en Telecommunicatiewet." : "Hard sending gate with legal basis, evidence, suppression list and unsubscribe — aligned with GDPR and Dutch law." },
  ];
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <div className="flex items-center gap-2">
          {user ? (
            <Button asChild><Link href="/overview">{t.nav.overview} <ArrowRight /></Link></Button>
          ) : (
            <>
              <Button variant="ghost" asChild><Link href="/login">{t.auth.login}</Link></Button>
              <Button asChild><Link href="/signup">{t.auth.signup}</Link></Button>
            </>
          )}
        </div>
      </header>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_50%_0%,oklch(0.93_0.05_262/.8),transparent)]" />
        <div className="relative mx-auto max-w-4xl px-6 pt-20 pb-16 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
            <Building2 className="size-3.5 text-primary" /> {nl ? "Voor AI-, web- en marketingagencies in Nederland" : "For AI, web and marketing agencies in the Netherlands"}
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-5xl leading-[1.05] font-semibold tracking-tight text-balance">
            {nl ? "Acquisitie die voelt als maatwerk — voor elk bedrijf opnieuw." : "Outbound that feels hand-crafted — for every single business."}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground text-balance">{t.brand.tagline}</p>
          <div className="mt-8 flex justify-center gap-3">
            <Button size="lg" asChild><Link href={user ? "/overview" : "/signup"}>{nl ? "Gratis starten" : "Start free"} <ArrowRight /></Link></Button>
            {!user && <Button size="lg" variant="outline" asChild><Link href="/login">{t.auth.login}</Link></Button>}
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary-soft"><f.icon className="size-4.5 text-primary" /></div>
            <p className="mt-4 text-[15px] font-semibold">{f.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

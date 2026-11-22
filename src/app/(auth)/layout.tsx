import { Logo } from "@/components/brand/logo";
import { getDictionary } from "@/i18n/server";
import { CheckCircle2 } from "lucide-react";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getDictionary();
  const points =
    t.meta.locale === "nl"
      ? ["Zoek bedrijven in heel Nederland op branche en regio", "AI onderzoekt elke website afzonderlijk", "Elk bedrijf krijgt een eigen, onderbouwde e-mail", "Compliance-poort voor AVG en Telecommunicatiewet"]
      : ["Search businesses across the Netherlands by industry and region", "AI researches every website individually", "Every business gets its own, evidence-based email", "Compliance gate for GDPR and the Dutch Telecommunications Act"];
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden border-l bg-sidebar lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_20%,oklch(0.92_0.05_262/.7),transparent),radial-gradient(40%_40%_at_20%_80%,oklch(0.95_0.03_230/.8),transparent)]" />
        <div className="relative flex h-full flex-col justify-center px-16">
          <p className="max-w-md text-3xl leading-tight font-semibold tracking-tight text-balance">{t.brand.tagline}</p>
          <ul className="mt-10 space-y-4">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[15px] text-muted-foreground">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

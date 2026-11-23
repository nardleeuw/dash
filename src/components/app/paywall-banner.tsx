import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDictionary } from "@/i18n/server";

/** Shown while the workspace has no paid plan (paywall on): look around, pay to use. */
export async function PaywallBanner() {
  const t = await getDictionary();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-primary-soft px-8 py-2.5 text-sm">
      <span className="flex items-center gap-2">
        <Lock className="size-4 text-primary" />
        <span><span className="font-medium">{t.paywall.title}</span> <span className="text-muted-foreground">{t.paywall.text}</span></span>
      </span>
      <Button size="sm" asChild><Link href="/billing">{t.paywall.cta}</Link></Button>
    </div>
  );
}

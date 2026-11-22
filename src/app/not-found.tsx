import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getDictionary } from "@/i18n/server";

export default async function NotFound() {
  const t = await getDictionary();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-5xl font-semibold tracking-tight text-muted-foreground">404</p>
      <p className="text-sm text-muted-foreground">{t.common.errors.notFound}</p>
      <Button asChild variant="outline"><Link href="/overview">{t.nav.overview}</Link></Button>
    </div>
  );
}

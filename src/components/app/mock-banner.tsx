import { FlaskConical } from "lucide-react";
import { getDictionary } from "@/i18n/server";
import { fmt } from "@/i18n/format";

const LABELS: Record<string, string> = {
  kvk: "KVK", google_places: "Google Places", osm: "OpenStreetMap", pdok: "PDOK", hunter: "Hunter.io",
  openai: "OpenAI", pagespeed: "PageSpeed", stripe: "Stripe",
};

export async function MockBanner({ providers }: { providers: string[] }) {
  if (providers.length === 0) return null;
  const t = await getDictionary();
  return (
    <div className="flex items-center gap-2 border-b border-dashed border-[oklch(0.85_0.09_80)] bg-warning-soft px-6 py-2 text-[13px]">
      <FlaskConical className="size-4 shrink-0 text-[oklch(0.6_0.14_65)]" />
      <span>{fmt(t.mock.banner, { providers: providers.map((p) => LABELS[p] ?? p).join(", ") })}</span>
    </div>
  );
}

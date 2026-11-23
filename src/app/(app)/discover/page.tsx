import { PageHeader } from "@/components/app/page-header";
import { getWorkspace } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { providerMode } from "@/server/providers/mode";
import { env } from "@/server/env";
import { industryOptions } from "@/config/industries";
import { DiscoverClient } from "./discover-client";

export const metadata = { title: "Bedrijven vinden" };

export default async function DiscoverPage() {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const supabase = await createClient();
  const [{ data: saved }, { data: lists }] = await Promise.all([
    supabase.from("saved_searches").select("id, name, filters, last_run_at, last_result_count").eq("org_id", ws.org.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("lead_lists").select("id, name").eq("org_id", ws.org.id).order("name"),
  ]);
  const kvkMode = providerMode("kvk");
  const providers = {
    kvk: kvkMode === "live" && /\/test\//.test(env().KVK_BASE) ? "test" : kvkMode,
    google_places: providerMode("google_places"),
    osm: providerMode("osm"),
  } as const;
  const industries = industryOptions(t.meta.locale === "en" ? "en" : "nl");
  return (
    <>
      <PageHeader title={t.discover.title} description={t.discover.subtitle} />
      <DiscoverClient
        providers={providers}
        industries={industries}
        savedSearches={(saved ?? []) as never}
        lists={lists ?? []}
        canWrite={ws.role !== "viewer"}
      />
    </>
  );
}

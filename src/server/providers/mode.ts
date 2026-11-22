import "server-only";
import { env, type Env } from "@/server/env";

export const PROVIDERS = ["kvk", "google_places", "osm", "pdok", "hunter", "openai", "pagespeed", "stripe"] as const;
export type ProviderKey = (typeof PROVIDERS)[number];
export type ProviderMode = "live" | "mock" | "disabled";

const KEY_OF: Partial<Record<ProviderKey, keyof Env>> = {
  kvk: "KVK_API_KEY",
  google_places: "GOOGLE_MAPS_API_KEY",
  hunter: "HUNTER_API_KEY",
  openai: "OPENAI_API_KEY",
  pagespeed: "GOOGLE_PAGESPEED_API_KEY",
  stripe: "STRIPE_SECRET_KEY",
};

/** Pure resolver (exported for tests). */
export function resolveProviderMode(key: ProviderKey, e: Pick<Env, "APP_ENV" | "MOCK_PROVIDERS"> & Partial<Env>): ProviderMode {
  const production = e.APP_ENV === "production";
  const forced = e.MOCK_PROVIDERS.split(",").map((s) => s.trim()).filter(Boolean);
  const envKey = KEY_OF[key];
  const hasKey = envKey ? Boolean(e[envKey]) : true; // keyless providers (OSM, PDOK)

  if (!production && forced.includes(key)) return "mock";
  if (hasKey) return "live";
  return production ? "disabled" : "mock";
}

export function providerMode(key: ProviderKey): ProviderMode {
  return resolveProviderMode(key, env());
}

export function mockProviders(): ProviderKey[] {
  return PROVIDERS.filter((p) => providerMode(p) === "mock");
}

export function providerStatusList() {
  return PROVIDERS.map((p) => ({ key: p, mode: providerMode(p) }));
}

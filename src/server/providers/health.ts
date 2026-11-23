import "server-only";
import { env } from "@/server/env";
import { providerMode, type ProviderKey } from "@/server/providers/mode";

export type HealthStatus = "ok" | "invalid_key" | "not_enabled" | "no_credit" | "not_configured" | "mock" | "error";
export type HealthResult = { provider: ProviderKey; status: HealthStatus; detail?: string };

/** Providers whose platform API key can be checked from the integrations page. */
export const CHECKED_PROVIDERS = ["openai", "google_places", "hunter"] as const satisfies readonly ProviderKey[];

/** A well-known place (Googleplex). Place Details with only the `id` field is a no-charge SKU. */
const GOOGLE_TEST_PLACE = "ChIJj61dQgK6j4AR4GeTYWZsKWw";

/** Maps an HTTP response of a provider's test call to a health status (pure; exported for tests). */
export function classifyHealth(provider: (typeof CHECKED_PROVIDERS)[number], status: number, body: string): HealthStatus {
  if (status >= 200 && status < 300) return "ok";
  if (provider === "openai") {
    if (status === 401) return "invalid_key";
    if (status === 429 && /insufficient_quota|credit/i.test(body)) return "no_credit";
    if (status === 403 || status === 404) return "not_enabled";
  }
  if (provider === "google_places") {
    if (/API_KEY_INVALID|API key not valid|API key expired/i.test(body)) return "invalid_key";
    if (/BILLING_DISABLED|billing/i.test(body)) return "no_credit";
    if (/SERVICE_DISABLED|API_KEY_SERVICE_BLOCKED|has not been used|is disabled|are blocked/i.test(body)) return "not_enabled";
    if (status === 401 || status === 403) return "invalid_key";
  }
  if (provider === "hunter") {
    if (status === 401) return "invalid_key";
    if (status === 403 || status === 429) return "no_credit";
  }
  return "error";
}

async function call(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  return { status: res.status, body: await res.text() };
}

async function checkOne(provider: (typeof CHECKED_PROVIDERS)[number]): Promise<HealthResult> {
  const mode = providerMode(provider);
  if (mode === "mock") return { provider, status: "mock" };
  if (mode === "disabled") return { provider, status: "not_configured" };
  const e = env();
  try {
    if (provider === "openai") {
      // A minimal generation also detects an exhausted balance (listing models does not).
      const r = await call("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${e.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: e.OPENAI_MODEL_RESEARCH, input: "ok", max_output_tokens: 16, store: false }),
      });
      return { provider, status: classifyHealth(provider, r.status, r.body) };
    }
    if (provider === "google_places") {
      const r = await call(`https://places.googleapis.com/v1/places/${GOOGLE_TEST_PLACE}`, {
        headers: { "X-Goog-Api-Key": e.GOOGLE_MAPS_API_KEY ?? "", "X-Goog-FieldMask": "id" },
      });
      return { provider, status: classifyHealth(provider, r.status, r.body) };
    }
    const r = await call("https://api.hunter.io/v2/account", { headers: { "X-API-KEY": e.HUNTER_API_KEY ?? "", Accept: "application/json" } });
    let status = classifyHealth(provider, r.status, r.body);
    let detail: string | undefined;
    if (status === "ok") {
      const searches = (JSON.parse(r.body) as { data?: { requests?: { searches?: { used?: number; available?: number } } } }).data?.requests?.searches;
      if (searches && typeof searches.available === "number" && typeof searches.used === "number") {
        detail = `${Math.max(0, searches.available - searches.used)}/${searches.available}`;
        if (searches.available - searches.used <= 0) status = "no_credit";
      }
    }
    return { provider, status, detail };
  } catch (err) {
    return { provider, status: "error", detail: (err as Error).name === "TimeoutError" ? "timeout" : undefined };
  }
}

export async function checkProviders(): Promise<HealthResult[]> {
  return Promise.all(CHECKED_PROVIDERS.map(checkOne));
}

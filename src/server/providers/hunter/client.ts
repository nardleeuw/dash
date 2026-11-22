import "server-only";
import { env } from "@/server/env";
import { providerFetch } from "../http";
import { PROVIDER_COST_MICROS } from "@/config/costs";

/** Hunter.io API v2 — https://hunter.io/api-documentation/ */
const BASE = "https://api.hunter.io/v2";

export type HunterSource = { domain: string; uri: string; extracted_on: string; last_seen_on: string; still_on_page: boolean };
export type HunterEmail = {
  value: string;
  type: "personal" | "generic";
  confidence: number;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  department: string | null;
  seniority?: string | null;
  linkedin?: string | null;
  phone_number?: string | null;
  verification?: { date: string | null; status: string | null };
  sources: HunterSource[];
};
export type HunterDomainSearch = { domain: string; organization: string | null; pattern: string | null; accept_all: boolean; webmail: boolean; disposable: boolean; emails: HunterEmail[] };
export type HunterVerification = { email: string; status: "valid" | "invalid" | "accept_all" | "webmail" | "disposable" | "unknown"; result?: string; score: number | null };

export interface HunterApi {
  domainSearch(domain: string, orgId?: string, limit?: number): Promise<HunterDomainSearch | null>;
  verify(email: string, orgId?: string): Promise<HunterVerification | null>;
}

export class HunterClient implements HunterApi {
  constructor(private readonly apiKey: string) {}

  private async get<T>(path: string, operation: keyof typeof PROVIDER_COST_MICROS.hunter, orgId?: string): Promise<T | null> {
    const res = await providerFetch(`${BASE}${path}`, { headers: { "X-API-KEY": this.apiKey, Accept: "application/json" } }, {
      provider: "hunter", operation, orgId, costMicros: PROVIDER_COST_MICROS.hunter[operation], passThrough: [400, 404, 451], timeoutMs: 25_000,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T };
    return json.data ?? null;
  }

  domainSearch(domain: string, orgId?: string, limit = 10) {
    return this.get<HunterDomainSearch>(`/domain-search?domain=${encodeURIComponent(domain)}&limit=${Math.min(limit, 100)}`, "domainSearch", orgId);
  }

  verify(email: string, orgId?: string) {
    return this.get<HunterVerification>(`/email-verifier?email=${encodeURIComponent(email)}`, "emailVerifier", orgId);
  }
}

export function createHunterClient() {
  const key = env().HUNTER_API_KEY;
  return key ? new HunterClient(key) : null;
}

import "server-only";
import { env } from "@/server/env";
import { providerFetch } from "../http";
import { PROVIDER_COST_MICROS } from "@/config/costs";
import type { KvkBasisprofiel, KvkNaamgeving, KvkSearchResponse, KvkVestigingenLijst, KvkVestigingsprofiel } from "./types";

export type KvkSearchParams = {
  naam?: string;
  plaats?: string;
  postcode?: string;
  huisnummer?: string;
  type?: string;
  inclusiefInactieveRegistraties?: boolean;
  pagina?: number;
  resultatenPerPagina?: number;
};

export interface KvkApi {
  readonly isTestEnvironment: boolean;
  search(params: KvkSearchParams, orgId?: string): Promise<KvkSearchResponse>;
  basisprofiel(kvkNumber: string, orgId?: string): Promise<KvkBasisprofiel | null>;
  vestigingen(kvkNumber: string, orgId?: string): Promise<KvkVestigingenLijst | null>;
  vestigingsprofiel(establishmentNumber: string, orgId?: string): Promise<KvkVestigingsprofiel | null>;
  naamgeving(kvkNumber: string, orgId?: string): Promise<KvkNaamgeving | null>;
}

/** Live client for the KVK Handelsregister API (test or production base URL). */
export class KvkClient implements KvkApi {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  get isTestEnvironment() {
    return /\/test\//.test(this.baseUrl);
  }

  private async get<T>(path: string, operation: keyof typeof PROVIDER_COST_MICROS.kvk, orgId?: string): Promise<T | null> {
    const res = await providerFetch(
      `${this.baseUrl.replace(/\/$/, "")}${path}`,
      { headers: { apikey: this.apiKey, Accept: "application/json" } },
      { provider: "kvk", operation, orgId, costMicros: PROVIDER_COST_MICROS.kvk[operation], passThrough: [404, 400] },
    );
    if (res.status === 404 || res.status === 400) return null;
    return (await res.json()) as T;
  }

  async search(params: KvkSearchParams, orgId?: string) {
    const qs = new URLSearchParams();
    if (params.naam) qs.set("naam", params.naam);
    if (params.plaats) qs.set("plaats", params.plaats);
    if (params.postcode) qs.set("postcode", params.postcode);
    if (params.huisnummer) qs.set("huisnummer", params.huisnummer);
    if (params.type) qs.set("type", params.type);
    if (params.inclusiefInactieveRegistraties) qs.set("InclusiefInactieveRegistraties", "true");
    qs.set("pagina", String(params.pagina ?? 1));
    qs.set("resultatenPerPagina", String(Math.min(params.resultatenPerPagina ?? 25, 100)));
    const data = await this.get<KvkSearchResponse>(`/v2/zoeken?${qs}`, "search", orgId);
    return data ?? { pagina: params.pagina ?? 1, resultatenPerPagina: 0, totaal: 0, resultaten: [] };
  }

  basisprofiel(kvkNumber: string, orgId?: string) {
    return this.get<KvkBasisprofiel>(`/v1/basisprofielen/${encodeURIComponent(kvkNumber)}`, "basisprofiel", orgId);
  }

  vestigingen(kvkNumber: string, orgId?: string) {
    return this.get<KvkVestigingenLijst>(`/v1/basisprofielen/${encodeURIComponent(kvkNumber)}/vestigingen`, "vestigingen", orgId);
  }

  vestigingsprofiel(establishmentNumber: string, orgId?: string) {
    return this.get<KvkVestigingsprofiel>(`/v1/vestigingsprofielen/${encodeURIComponent(establishmentNumber)}?geoData=true`, "vestigingsprofiel", orgId);
  }

  naamgeving(kvkNumber: string, orgId?: string) {
    return this.get<KvkNaamgeving>(`/v1/naamgevingen/kvknummer/${encodeURIComponent(kvkNumber)}`, "naamgeving", orgId);
  }
}

export function createKvkClient(): KvkClient | null {
  const e = env();
  if (!e.KVK_API_KEY) return null;
  return new KvkClient(e.KVK_API_KEY, e.KVK_BASE);
}

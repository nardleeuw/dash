import "server-only";
import { providerFetch } from "../http";
import type { DiscoveredBusiness } from "../types";
import { INDUSTRIES } from "@/config/industries";
import { normalizePhone, normalizePostalCode, normalizeUrl } from "@/server/discovery/normalize";

export const OSM_ATTRIBUTION = "© OpenStreetMap-bijdragers (ODbL)";
const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";

export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type OverpassArea =
  | { kind: "admin"; name: string; adminLevel: 4 | 8 }
  | { kind: "around"; lat: number; lng: number; radiusM: number };

/** Build a safe Overpass QL query. Names are escaped; tag filters come from our own config only. */
export function buildOverpassQuery(tagFilters: string[], area: OverpassArea, limit = 300): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const filters = tagFilters.filter((f) => /^\["[a-z:_]+"="[a-z_;:]+"\]$/.test(f));
  if (filters.length === 0) throw new Error("no valid tag filters");
  if (area.kind === "admin") {
    return `[out:json][timeout:25];area["boundary"="administrative"]["admin_level"="${area.adminLevel}"]["name"="${esc(area.name)}"]->.a;(${filters
      .map((f) => `nwr${f}["name"](area.a);`)
      .join("")});out center tags ${limit};`;
  }
  const r = Math.min(Math.max(Math.round(area.radiusM), 100), 30_000);
  return `[out:json][timeout:25];(${filters.map((f) => `nwr${f}["name"](around:${r},${area.lat},${area.lng});`).join("")});out center tags ${limit};`;
}

export function mapOsmElement(el: OsmElement, isMock = false): DiscoveredBusiness | null {
  const t = el.tags ?? {};
  if (!t.name) return null;
  const lat = el.lat ?? el.center?.lat ?? null;
  const lng = el.lon ?? el.center?.lon ?? null;
  const categories = Object.entries(t)
    .filter(([k]) => ["amenity", "shop", "craft", "office", "healthcare", "leisure", "tourism"].includes(k))
    .map(([k, v]) => `${k}=${v}`);
  const industry = INDUSTRIES.find((ind) => ind.osm.some((f) => categories.some((c) => f === `["${c.split("=")[0]}"="${c.split("=")[1]}"]`)))?.key ?? null;
  return {
    provider: "osm",
    externalId: `${el.type}/${el.id}`,
    name: t.name,
    address: {
      street: t["addr:street"] ?? null,
      houseNumber: t["addr:housenumber"] ?? null,
      postalCode: normalizePostalCode(t["addr:postcode"]),
      city: t["addr:city"] ?? null,
      country: "NL",
    },
    lat,
    lng,
    coordinatesShareable: true,
    website: normalizeUrl(t.website ?? t["contact:website"]),
    phone: normalizePhone(t.phone ?? t["contact:phone"]),
    email: (t.email ?? t["contact:email"])?.toLowerCase() ?? null,
    categories,
    industry,
    businessStatus: t["disused"] === "yes" ? "inactive" : "unknown",
    isMock,
    attribution: OSM_ATTRIBUTION,
  };
}

export interface OverpassApi {
  query(ql: string, orgId?: string): Promise<OsmElement[]>;
}

export class OverpassClient implements OverpassApi {
  constructor(private readonly endpoint = process.env.OVERPASS_URL || DEFAULT_ENDPOINT, private readonly appUrl = process.env.APP_URL ?? "") {}

  async query(ql: string, orgId?: string) {
    const res = await providerFetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": `Leadwerk/0.1 (${this.appUrl || "leadwerk"})` },
      body: new URLSearchParams({ data: ql }).toString(),
    }, { provider: "osm", operation: "overpass", orgId, timeoutMs: 35_000, retries: 1 });
    const json = (await res.json()) as { elements?: OsmElement[] };
    return json.elements ?? [];
  }
}

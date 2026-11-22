import "server-only";
import { createHash } from "node:crypto";
import type { DiscoveredBusiness, DiscoveryProvider, DiscoveryQuery, LocationFilter, ProviderPage } from "@/server/providers/types";
import { ProviderError } from "@/server/providers/types";
import { getKvk, getOverpass, getPlaces } from "@/server/providers/registry";
import { mapSearchResult } from "@/server/providers/kvk/map";
import { mapPlace } from "@/server/providers/google-places/client";
import { buildOverpassQuery, mapOsmElement, type OverpassArea } from "@/server/providers/osm/client";
import { INDUSTRY_BY_KEY } from "@/config/industries";
import { NL_BBOX, PROVINCE_BY_NAME } from "@/config/geo";
import { consumeCredits } from "@/server/usage";
import { mergeSearchResults, type MergedResult } from "./dedupe";

export type SearchRequest = DiscoveryQuery & {
  providers: DiscoveryProvider[];
  cursors: Partial<Record<DiscoveryProvider, string | null>>;
};

export type SearchResponse = {
  pages: ProviderPage[];
  merged: MergedResult[];
  errors: { provider: DiscoveryProvider; message: string }[];
};

const MAX_COMBOS = 9; // locations × industries searched on Google per query (cost cap)
const OSM_PAGE = 50;

/* ------------------------------------------------------------------ KVK */
async function searchKvk(q: SearchRequest, cursor: string | null, orgId: string): Promise<ProviderPage> {
  const kvk = getKvk();
  if (!kvk) return { provider: "kvk", results: [], nextCursor: null, notice: "not_configured" };
  const place = q.locations.find((l) => l.type === "city" || l.type === "municipality");
  const postcode = q.locations.find((l) => l.type === "postcode");
  if (!q.text?.trim()) {
    return { provider: "kvk", results: [], nextCursor: null, notice: "kvk_requires_name" };
  }
  const page = cursor ? Number(cursor) : 1;
  const res = await kvk.client.search({
    naam: q.text.trim(),
    plaats: place?.name,
    postcode: postcode?.name.replace(/\s/g, ""),
    type: q.kvkType,
    inclusiefInactieveRegistraties: q.activeOnly === false,
    pagina: page,
    resultatenPerPagina: 50,
  }, orgId);
  const results = res.resultaten.map((r) => mapSearchResult(r, kvk.isMock));
  const more = res.pagina * res.resultatenPerPagina < res.totaal;
  return { provider: "kvk", results, nextCursor: more ? String(page + 1) : null, total: res.totaal, notice: kvk.isMock ? "mock" : undefined };
}

/* ------------------------------------------------------- Google Places */
type GoogleTask = { textQuery: string; includedType?: string; rectangle?: [number, number, number, number]; circle?: { lat: number; lng: number; radiusM: number } };

function googleTasks(q: SearchRequest): GoogleTask[] {
  const locations: LocationFilter[] = q.locations.length ? q.locations : [{ type: "nl" }];
  const industries = q.industries.length ? q.industries.map((k) => INDUSTRY_BY_KEY.get(k)).filter(Boolean) : [null];
  const tasks: GoogleTask[] = [];
  for (const loc of locations) {
    for (const ind of industries) {
      const term = [ind ? ind.googleQuery[q.language] : null, q.text?.trim()].filter(Boolean).join(" ");
      if (!term) continue;
      const where = loc.type === "nl" ? "Nederland" : loc.name;
      const task: GoogleTask = { textQuery: `${term} in ${where}`, includedType: ind?.googleType };
      if (loc.type === "nl") task.rectangle = NL_BBOX;
      else if (loc.type === "province") task.rectangle = PROVINCE_BY_NAME.get(loc.name.toLowerCase())?.bbox ?? undefined;
      else {
        const km = loc.type === "radius" ? loc.radiusKm : q.radiusKm ?? (loc.type === "postcode" ? 3 : 8);
        task.circle = { lat: loc.lat, lng: loc.lng, radiusM: km * 1000 };
      }
      tasks.push(task);
      if (tasks.length >= MAX_COMBOS) return tasks;
    }
  }
  return tasks;
}

async function searchGoogle(q: SearchRequest, cursor: string | null, orgId: string): Promise<ProviderPage> {
  const places = getPlaces();
  if (!places) return { provider: "google_places", results: [], nextCursor: null, notice: "not_configured" };
  const tasks = googleTasks(q);
  if (tasks.length === 0) return { provider: "google_places", results: [], nextCursor: null, notice: "needs_term" };
  const [idxStr, token] = (cursor ?? "0:").split(":");
  const idx = Number(idxStr) || 0;
  const task = tasks[idx];
  if (!task) return { provider: "google_places", results: [], nextCursor: null };
  const { places: list, nextPageToken } = await places.client.searchText({ ...task, pageToken: token || undefined, languageCode: q.language }, orgId);
  const results = list.map((p) => mapPlace(p, places.isMock));
  const nextCursor = nextPageToken ? `${idx}:${nextPageToken}` : idx + 1 < tasks.length ? `${idx + 1}:` : null;
  return { provider: "google_places", results, nextCursor, notice: places.isMock ? "mock" : undefined };
}

/* ----------------------------------------------------------------- OSM */
const osmCache = new Map<string, { at: number; results: DiscoveredBusiness[] }>();

function osmArea(loc: LocationFilter, radiusKm?: number): OverpassArea | null {
  switch (loc.type) {
    case "nl":
      return null;
    case "province":
      return { kind: "admin", name: loc.name, adminLevel: 4 };
    case "municipality":
      return { kind: "admin", name: loc.name, adminLevel: 8 };
    case "radius":
      return { kind: "around", lat: loc.lat, lng: loc.lng, radiusM: loc.radiusKm * 1000 };
    default:
      return { kind: "around", lat: loc.lat, lng: loc.lng, radiusM: (radiusKm ?? (loc.type === "postcode" ? 2 : 6)) * 1000 };
  }
}

async function searchOsm(q: SearchRequest, cursor: string | null, orgId: string): Promise<ProviderPage> {
  const osm = getOverpass();
  if (!osm) return { provider: "osm", results: [], nextCursor: null, notice: "not_configured" };
  const tags = q.industries.flatMap((k) => INDUSTRY_BY_KEY.get(k)?.osm ?? []);
  if (tags.length === 0) return { provider: "osm", results: [], nextCursor: null, notice: "osm_requires_industry" };
  const areas = q.locations.map((l) => osmArea(l, q.radiusKm)).filter((a): a is OverpassArea => !!a).slice(0, 3);
  if (areas.length === 0) return { provider: "osm", results: [], nextCursor: null, notice: "osm_requires_location" };

  const key = JSON.stringify({ tags, areas, mock: osm.isMock });
  let cached = osmCache.get(key);
  if (!cached || Date.now() - cached.at > 10 * 60_000) {
    const all: DiscoveredBusiness[] = [];
    for (const area of areas) {
      const elements = await osm.client.query(buildOverpassQuery(tags, area), orgId);
      for (const el of elements) {
        const m = mapOsmElement(el, osm.isMock);
        if (m) all.push(m);
      }
    }
    const unique = [...new Map(all.map((r) => [r.externalId, r])).values()];
    cached = { at: Date.now(), results: unique };
    osmCache.set(key, cached);
    if (osmCache.size > 100) osmCache.delete(osmCache.keys().next().value!);
  }
  const offset = cursor ? Number(cursor) : 0;
  const slice = cached.results.slice(offset, offset + OSM_PAGE);
  const next = offset + OSM_PAGE < cached.results.length ? String(offset + OSM_PAGE) : null;
  return { provider: "osm", results: slice, nextCursor: next, total: cached.results.length, notice: osm.isMock ? "mock" : undefined };
}

/* ---------------------------------------------------------- orchestrator */
const SEARCHERS: Record<DiscoveryProvider, (q: SearchRequest, c: string | null, orgId: string) => Promise<ProviderPage>> = {
  kvk: searchKvk,
  google_places: searchGoogle,
  osm: searchOsm,
};

export function applyResultFilters(results: DiscoveredBusiness[], q: Pick<DiscoveryQuery, "requireWebsite" | "requirePhone" | "activeOnly">) {
  return results.filter((r) => {
    if (q.activeOnly !== false && r.businessStatus === "inactive") return false;
    if (q.requireWebsite && !r.website) return false;
    if (q.requirePhone && !r.phone) return false;
    return true;
  });
}

export async function runDiscovery(orgId: string, userId: string, q: SearchRequest): Promise<SearchResponse> {
  const providers = q.providers.filter((p) => q.cursors[p] !== null);
  const settled = await Promise.allSettled(
    providers.map(async (p) => {
      const page = await SEARCHERS[p](q, q.cursors[p] ?? null, orgId);
      if (page.results.length > 0 && page.notice !== "mock") {
        const fingerprint = createHash("sha1").update(JSON.stringify([p, q.text, q.industries, q.locations, q.cursors[p] ?? "", Math.floor(Date.now() / 60_000)])).digest("hex");
        await consumeCredits({ orgId, kind: "search", idempotencyKey: `search:${fingerprint}`, userId, referenceType: "discovery" });
      }
      return page;
    }),
  );
  const pages: ProviderPage[] = [];
  const errors: SearchResponse["errors"] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") pages.push(s.value);
    else {
      const err = s.reason;
      if (err?.name === "CreditsExhaustedError") throw err;
      console.error("[discovery]", providers[i], err);
      errors.push({ provider: providers[i], message: err instanceof ProviderError ? `provider_error_${err.status ?? "network"}` : "provider_error" });
    }
  });
  const all = applyResultFilters(pages.flatMap((p) => p.results), q);
  return { pages, merged: mergeSearchResults(all), errors };
}

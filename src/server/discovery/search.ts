import "server-only";
import { createHash } from "node:crypto";
import type { DiscoveredBusiness, DiscoveryProvider, DiscoveryQuery, LocationFilter, ProviderPage } from "@/server/providers/types";
import { ProviderError } from "@/server/providers/types";
import { getKvk, getOverpass, getPlaces } from "@/server/providers/registry";
import { mapSearchResult } from "@/server/providers/kvk/map";
import { mapPlace } from "@/server/providers/google-places/client";
import { buildOverpassQuery, mapOsmElement, type OverpassArea } from "@/server/providers/osm/client";
import { googleQueriesFor, INDUSTRY_BY_KEY } from "@/config/industries";
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
/**
 * Google Text Search returns at most 20 places per page and 60 per query. To
 * find (close to) every business in an area we split the area into a grid of
 * tiles (locationRestriction rectangles), run every query variant of an
 * industry per tile, and follow all pages. The cursor walks through that task
 * list; the client keeps loading until it has enough results.
 */
type Box = [number, number, number, number]; // [south, west, north, east]
type GoogleTask = { textQuery: string; includedType?: string; rectangle: Box };

const GOOGLE_TASKS_PER_CALL = 4; // tasks fetched in parallel per server call
const GOOGLE_MAX_PAGES = 3; // Google's own cap (3 × 20 = 60 per query)
const GOOGLE_MAX_TASKS = 120; // hard cap per search (cost)

export function circleBox(lat: number, lng: number, radiusM: number): Box {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
}

export function splitBox([s, w, n, e]: Box, parts: number): Box[] {
  const out: Box[] = [];
  const h = (n - s) / parts;
  const v = (e - w) / parts;
  for (let i = 0; i < parts; i++) for (let j = 0; j < parts; j++) out.push([s + i * h, w + j * v, s + (i + 1) * h, w + (j + 1) * v]);
  return out;
}

function areaTiles(loc: LocationFilter, radiusKm?: number): Box[] {
  if (loc.type === "nl") return splitBox(NL_BBOX, 4);
  if (loc.type === "province") {
    const bbox = PROVINCE_BY_NAME.get(loc.name.toLowerCase())?.bbox;
    return bbox ? splitBox(bbox as Box, 4) : splitBox(circleBox(loc.lat, loc.lng, 30_000), 4);
  }
  const km = loc.type === "radius" ? loc.radiusKm : radiusKm ?? (loc.type === "postcode" ? 3 : 7);
  const grid = km <= 2 ? 1 : km <= 4 ? 2 : km <= 10 ? 3 : km <= 25 ? 4 : 5;
  return splitBox(circleBox(loc.lat, loc.lng, km * 1000), grid);
}

export function googleTasks(q: Pick<SearchRequest, "locations" | "industries" | "text" | "language" | "radiusKm">): GoogleTask[] {
  const locations: LocationFilter[] = q.locations.length ? q.locations : [{ type: "nl" }];
  const industries = q.industries.length ? q.industries.map((k) => INDUSTRY_BY_KEY.get(k)).filter((i) => !!i) : [null];
  const text = q.text?.trim() || null;
  const tasks: GoogleTask[] = [];
  for (const loc of locations) {
    const tiles = areaTiles(loc, q.radiusKm);
    for (const ind of industries) {
      const queries = ind ? googleQueriesFor(ind, q.language).map((t) => (text ? `${t} ${text}` : t)) : text ? [text] : [];
      // Query-major order: the first calls cover the whole area with the main query.
      // Only the main query is restricted to the Google type; variants ("lunchroom")
      // must also find places Google files under another type ("restaurant").
      queries.forEach((textQuery, qi) => {
        for (const rectangle of tiles) tasks.push({ textQuery, includedType: qi === 0 ? ind?.googleType : undefined, rectangle });
      });
    }
  }
  return tasks.slice(0, GOOGLE_MAX_TASKS);
}

async function searchGoogle(q: SearchRequest, cursor: string | null, orgId: string): Promise<ProviderPage> {
  const places = getPlaces();
  if (!places) return { provider: "google_places", results: [], nextCursor: null, notice: "not_configured" };
  const tasks = googleTasks(q);
  if (tasks.length === 0) return { provider: "google_places", results: [], nextCursor: null, notice: "needs_term" };
  const start = Math.max(0, Number(cursor ?? 0) || 0);
  const batch = tasks.slice(start, start + GOOGLE_TASKS_PER_CALL);
  // One failing tile must not break the whole batch: keep what we got.
  const settled = await Promise.allSettled(
    batch.map(async (task) => {
      const out: Awaited<ReturnType<typeof places.client.searchText>>["places"] = [];
      let token: string | undefined;
      for (let page = 0; page < GOOGLE_MAX_PAGES; page++) {
        const res = await places.client.searchText({ ...task, pageToken: token, languageCode: q.language }, orgId);
        out.push(...res.places);
        if (!res.nextPageToken || res.places.length < 20) break;
        token = res.nextPageToken;
      }
      return out;
    }),
  );
  const failed = settled.filter((r) => r.status === "rejected");
  for (const f of failed) console.error("[discovery] google task failed", (f as PromiseRejectedResult).reason);
  if (failed.length === settled.length) throw (failed[0] as PromiseRejectedResult).reason;
  const lists = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const unique = [...new Map(lists.flat().map((p) => [p.id, p])).values()];
  const done = start + batch.length;
  return {
    provider: "google_places",
    results: unique.flatMap((p) => {
      try {
        return [mapPlace(p, places.isMock)];
      } catch (err) {
        console.error("[discovery] could not map place", p.id, err);
        return [];
      }
    }),
    nextCursor: done < tasks.length ? String(done) : null,
    progress: { done, total: tasks.length },
    notice: places.isMock ? "mock" : undefined,
  };
}

/* ----------------------------------------------------------------- OSM */
const osmCache = new Map<string, { at: number; results: DiscoveredBusiness[] }>();
let osmDownUntil = 0; // circuit breaker: skip OSM for a while after a failure

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

  if (!osm.isMock && Date.now() < osmDownUntil) return { provider: "osm", results: [], nextCursor: null, notice: "osm_unavailable" };
  const key = JSON.stringify({ tags, areas, mock: osm.isMock });
  let cached = osmCache.get(key);
  if (!cached || Date.now() - cached.at > 10 * 60_000) {
    const all: DiscoveredBusiness[] = [];
    for (const area of areas) {
      let elements;
      try {
        elements = await osm.client.query(buildOverpassQuery(tags, area), orgId);
      } catch {
        osmDownUntil = Date.now() + 15 * 60_000;
        return { provider: "osm", results: [], nextCursor: null, notice: "osm_unavailable" };
      }
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
      const kind = err instanceof ProviderError ? `provider_error_${err.status ?? "network"}` : `provider_error:${String(err?.name ?? "Error").slice(0, 40)}${err?.code ? ":" + String(err.code).slice(0, 20) : ""}`;
      errors.push({ provider: providers[i], message: kind });
    }
  });
  const all = applyResultFilters(pages.flatMap((p) => p.results), q);
  return { pages, merged: mergeSearchResults(all), errors };
}

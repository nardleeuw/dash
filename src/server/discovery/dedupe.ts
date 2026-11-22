/**
 * Deduplication engine. Principles:
 *  - Hard identifiers decide: KVK number = legal company; establishment number,
 *    Google place id and OSM id = a specific establishment.
 *  - Conflicting hard identifiers NEVER merge (two branches of a chain with
 *    different establishment numbers stay separate; franchises with different
 *    KVK numbers stay separate businesses even when they share a domain).
 *  - Soft matches (domain+postcode, name+postcode+house number) only link to an
 *    existing location when no hard identifier contradicts them.
 */
import type { DiscoveredBusiness } from "@/server/providers/types";
import { extractDomain, isPlatformDomain, nameSimilarity, normalizeHouseNumber, normalizeName, normalizePostalCode } from "./normalize";

export type IdentityRecord = {
  businessId?: string;
  locationId?: string;
  name: string;
  kvkNumber?: string | null;
  establishmentNumber?: string | null;
  googlePlaceId?: string | null;
  osmId?: string | null;
  website?: string | null;
  postalCode?: string | null;
  houseNumber?: string | null;
  city?: string | null;
};

export type MatchResult =
  | { kind: "location"; businessId: string; locationId: string; confidence: number; reason: string }
  | { kind: "business"; businessId: string; confidence: number; reason: string }
  | { kind: "none"; reason: string; possibleDuplicateOf?: string };

const SOFT_MATCH_THRESHOLD = 0.9;

function conflicts(a: IdentityRecord, b: IdentityRecord) {
  if (a.kvkNumber && b.kvkNumber && a.kvkNumber !== b.kvkNumber) return "kvk_conflict";
  if (a.establishmentNumber && b.establishmentNumber && a.establishmentNumber !== b.establishmentNumber) return "establishment_conflict";
  if (a.googlePlaceId && b.googlePlaceId && a.googlePlaceId !== b.googlePlaceId) return "place_conflict";
  if (a.osmId && b.osmId && a.osmId !== b.osmId) return "osm_conflict";
  return null;
}

function softLocationScore(a: IdentityRecord, b: IdentityRecord): { score: number; reason: string } {
  const pcA = normalizePostalCode(a.postalCode);
  const pcB = normalizePostalCode(b.postalCode);
  const domA = extractDomain(a.website);
  const domB = extractDomain(b.website);
  const samePostcode = !!pcA && pcA === pcB;

  if (samePostcode && domA && domA === domB && !isPlatformDomain(domA)) return { score: 0.95, reason: "domain+postcode" };

  const sim = nameSimilarity(a.name, b.name);
  const hnA = normalizeHouseNumber(a.houseNumber);
  const hnB = normalizeHouseNumber(b.houseNumber);
  if (samePostcode && sim >= 0.85) {
    if (hnA && hnB && hnA !== hnB) return { score: 0, reason: "house_number_differs" };
    return { score: hnA && hnB ? 0.93 : 0.9, reason: "name+postcode" };
  }
  return { score: 0, reason: "no_soft_match" };
}

/** Find how a candidate relates to already-stored records. */
export function findMatch(candidate: IdentityRecord, existing: IdentityRecord[]): MatchResult {
  // 1. Exact establishment identifiers.
  for (const e of existing) {
    if (!e.businessId || !e.locationId) continue;
    if (
      (candidate.establishmentNumber && candidate.establishmentNumber === e.establishmentNumber) ||
      (candidate.googlePlaceId && candidate.googlePlaceId === e.googlePlaceId) ||
      (candidate.osmId && candidate.osmId === e.osmId)
    ) {
      const conflict = conflicts(candidate, e);
      if (conflict === "kvk_conflict") continue; // identifiers disagree: do not merge
      return { kind: "location", businessId: e.businessId, locationId: e.locationId, confidence: 1, reason: "establishment_identifier" };
    }
  }
  // 2. Same legal company (KVK number) — may be a new establishment.
  if (candidate.kvkNumber) {
    const sameCompany = existing.filter((e) => e.businessId && e.kvkNumber === candidate.kvkNumber);
    for (const e of sameCompany) {
      if (!e.locationId) continue;
      if (conflicts(candidate, e)) continue;
      if (!candidate.establishmentNumber || !e.establishmentNumber) {
        const soft = softLocationScore(candidate, e);
        if (soft.score >= SOFT_MATCH_THRESHOLD) {
          return { kind: "location", businessId: e.businessId!, locationId: e.locationId, confidence: soft.score, reason: `kvk+${soft.reason}` };
        }
      }
    }
    if (sameCompany[0]?.businessId) return { kind: "business", businessId: sameCompany[0].businessId, confidence: 1, reason: "kvk_number" };
  }
  // 3. Soft matches without contradicting identifiers.
  let best: { e: IdentityRecord; score: number; reason: string } | null = null;
  let possible: string | undefined;
  for (const e of existing) {
    if (!e.businessId || !e.locationId) continue;
    if (conflicts(candidate, e)) continue;
    const soft = softLocationScore(candidate, e);
    if (soft.score > (best?.score ?? 0)) best = { e, ...soft };
    if (!possible && soft.score === 0 && nameSimilarity(candidate.name, e.name) >= 0.92 && candidate.city && e.city &&
        candidate.city.toLowerCase() === e.city.toLowerCase()) {
      possible = e.businessId;
    }
  }
  if (best && best.score >= SOFT_MATCH_THRESHOLD) {
    return { kind: "location", businessId: best.e.businessId!, locationId: best.e.locationId!, confidence: best.score, reason: best.reason };
  }
  return { kind: "none", reason: "no_match", possibleDuplicateOf: possible };
}

export function identityOf(b: DiscoveredBusiness): IdentityRecord {
  return {
    name: b.name,
    kvkNumber: b.kvkNumber ?? null,
    establishmentNumber: b.establishmentNumber ?? null,
    googlePlaceId: b.provider === "google_places" ? b.externalId : null,
    osmId: b.provider === "osm" ? b.externalId : null,
    website: b.website ?? null,
    postalCode: b.address.postalCode ?? null,
    houseNumber: b.address.houseNumber ?? null,
    city: b.address.city ?? null,
  };
}

export type MergedResult = {
  key: string;
  primary: DiscoveredBusiness;
  sources: DiscoveredBusiness[];
};

/**
 * Group search results from several providers that describe the same place,
 * for display. Conservative: only merges on identifiers or strong soft matches.
 */
export function mergeSearchResults(results: DiscoveredBusiness[]): MergedResult[] {
  const groups: { identity: IdentityRecord; items: DiscoveredBusiness[] }[] = [];
  for (const r of results) {
    const id = identityOf(r);
    let target: (typeof groups)[number] | undefined;
    for (const g of groups) {
      if (conflicts(id, g.identity)) continue;
      const sameEst = id.establishmentNumber && id.establishmentNumber === g.identity.establishmentNumber;
      const sameKvkNoEst = id.kvkNumber && id.kvkNumber === g.identity.kvkNumber && !id.establishmentNumber && !g.identity.establishmentNumber;
      const soft = softLocationScore(id, g.identity);
      const sameCityName =
        !normalizePostalCode(id.postalCode) || !normalizePostalCode(g.identity.postalCode)
          ? id.city && g.identity.city && id.city.toLowerCase() === g.identity.city.toLowerCase() && normalizeName(id.name) === normalizeName(g.identity.name)
          : false;
      if (sameEst || sameKvkNoEst || soft.score >= SOFT_MATCH_THRESHOLD || sameCityName) {
        target = g;
        break;
      }
    }
    if (target) {
      target.items.push(r);
      // Accumulate identifiers so later results can match on them.
      target.identity = {
        ...target.identity,
        kvkNumber: target.identity.kvkNumber ?? id.kvkNumber,
        establishmentNumber: target.identity.establishmentNumber ?? id.establishmentNumber,
        googlePlaceId: target.identity.googlePlaceId ?? id.googlePlaceId,
        osmId: target.identity.osmId ?? id.osmId,
        website: target.identity.website ?? id.website,
        postalCode: target.identity.postalCode ?? id.postalCode,
        houseNumber: target.identity.houseNumber ?? id.houseNumber,
      };
    } else {
      groups.push({ identity: id, items: [r] });
    }
  }
  const rank = { kvk: 0, google_places: 1, osm: 2 } as const;
  return groups.map((g) => {
    const sorted = [...g.items].sort((a, b) => rank[a.provider] - rank[b.provider]);
    const primary = { ...sorted[0] };
    // Fill gaps in the primary record from other sources (display only).
    for (const s of sorted.slice(1)) {
      primary.website ??= s.website;
      primary.phone ??= s.phone;
      primary.email ??= s.email;
      if (primary.lat == null && s.lat != null && s.coordinatesShareable) {
        primary.lat = s.lat;
        primary.lng = s.lng;
        primary.coordinatesShareable = true;
      }
      primary.address = {
        street: primary.address.street ?? s.address.street,
        houseNumber: primary.address.houseNumber ?? s.address.houseNumber,
        postalCode: primary.address.postalCode ?? s.address.postalCode,
        city: primary.address.city ?? s.address.city,
      };
      primary.industry ??= s.industry;
      primary.rating ??= s.rating;
      primary.reviewCount ??= s.reviewCount;
    }
    const key = sorted.map((s) => `${s.provider}:${s.externalId}`).join("|");
    return { key, primary, sources: sorted };
  });
}

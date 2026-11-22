import "server-only";
import { env } from "@/server/env";
import { providerFetch } from "../http";
import { PROVIDER_COST_MICROS } from "@/config/costs";
import type { DiscoveredBusiness } from "../types";
import { industryFromGoogleTypes } from "@/config/industries";
import { normalizePhone, normalizePostalCode, normalizeUrl } from "@/server/discovery/normalize";

/** Google Places API (New) — https://developers.google.com/maps/documentation/places/web-service/overview */
const BASE = "https://places.googleapis.com/v1";

// Request only what we display: field masks drive cost.
const SEARCH_FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.addressComponents", "places.location",
  "places.types", "places.primaryType", "places.websiteUri", "places.nationalPhoneNumber", "places.rating",
  "places.userRatingCount", "places.businessStatus", "nextPageToken",
].join(",");
const DETAIL_FIELDS = SEARCH_FIELDS.replace(/places\./g, "").replace(",nextPageToken", "");

export const GOOGLE_ATTRIBUTION = "Google Maps";

export type GooglePlace = {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  addressComponents?: { longText: string; shortText: string; types: string[] }[];
  location?: { latitude: number; longitude: number };
  types?: string[];
  primaryType?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
};

export type TextSearchRequest = {
  textQuery: string;
  includedType?: string;
  pageToken?: string;
  rectangle?: [number, number, number, number]; // [south, west, north, east]
  circle?: { lat: number; lng: number; radiusM: number };
  languageCode: "nl" | "en";
};

export interface PlacesApi {
  searchText(req: TextSearchRequest, orgId?: string): Promise<{ places: GooglePlace[]; nextPageToken: string | null }>;
  details(placeId: string, orgId?: string): Promise<GooglePlace | null>;
}

export class GooglePlacesClient implements PlacesApi {
  constructor(private readonly apiKey: string) {}

  async searchText(req: TextSearchRequest, orgId?: string) {
    const body: Record<string, unknown> = {
      textQuery: req.textQuery,
      languageCode: req.languageCode,
      regionCode: "NL",
      pageSize: 20,
    };
    if (req.includedType) body.includedType = req.includedType;
    if (req.pageToken) body.pageToken = req.pageToken;
    if (req.rectangle) {
      const [s, w, n, e] = req.rectangle;
      body.locationRestriction = { rectangle: { low: { latitude: s, longitude: w }, high: { latitude: n, longitude: e } } };
    } else if (req.circle) {
      body.locationBias = { circle: { center: { latitude: req.circle.lat, longitude: req.circle.lng }, radius: Math.min(req.circle.radiusM, 50_000) } };
    }
    const res = await providerFetch(`${BASE}/places:searchText`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": SEARCH_FIELDS },
      body: JSON.stringify(body),
    }, { provider: "google_places", operation: "searchText", orgId, costMicros: PROVIDER_COST_MICROS.google_places.searchText });
    const json = (await res.json()) as { places?: GooglePlace[]; nextPageToken?: string };
    return { places: json.places ?? [], nextPageToken: json.nextPageToken ?? null };
  }

  async details(placeId: string, orgId?: string) {
    const res = await providerFetch(`${BASE}/places/${encodeURIComponent(placeId)}?languageCode=nl&regionCode=NL`, {
      headers: { "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": DETAIL_FIELDS },
    }, { provider: "google_places", operation: "details", orgId, costMicros: PROVIDER_COST_MICROS.google_places.details, passThrough: [404] });
    if (res.status === 404) return null;
    return (await res.json()) as GooglePlace;
  }
}

function component(p: GooglePlace, type: string) {
  return p.addressComponents?.find((c) => c.types.includes(type))?.longText ?? null;
}

export function mapPlace(p: GooglePlace, isMock = false): DiscoveredBusiness {
  return {
    provider: "google_places",
    externalId: p.id,
    name: p.displayName?.text ?? "—",
    address: {
      street: component(p, "route"),
      houseNumber: component(p, "street_number"),
      postalCode: normalizePostalCode(component(p, "postal_code")),
      city: component(p, "locality") ?? component(p, "postal_town"),
      country: "NL",
    },
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    coordinatesShareable: isMock, // Google coordinates may not be shown on a non-Google map
    website: normalizeUrl(p.websiteUri),
    phone: normalizePhone(p.nationalPhoneNumber),
    categories: p.types ?? [],
    industry: industryFromGoogleTypes(p.types ?? []),
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? null,
    businessStatus: p.businessStatus === "CLOSED_PERMANENTLY" ? "inactive" : p.businessStatus ? "active" : "unknown",
    isMock,
    attribution: GOOGLE_ATTRIBUTION,
  };
}

export function createPlacesClient(): GooglePlacesClient | null {
  const key = env().GOOGLE_MAPS_API_KEY;
  return key ? new GooglePlacesClient(key) : null;
}

/** Shared types for discovery providers. Provider-specific shapes never leak past adapters. */

export type DiscoveryProvider = "kvk" | "google_places" | "osm";

export type LocationFilter =
  | { type: "nl" }
  | { type: "province"; name: string; lat: number; lng: number }
  | { type: "municipality"; name: string; lat: number; lng: number }
  | { type: "city"; name: string; lat: number; lng: number }
  | { type: "postcode"; name: string; lat: number; lng: number }
  | { type: "radius"; name: string; lat: number; lng: number; radiusKm: number };

export type DiscoveryQuery = {
  text?: string;
  industries: string[];
  locations: LocationFilter[];
  radiusKm?: number;
  activeOnly?: boolean;
  kvkType?: "hoofdvestiging" | "nevenvestiging" | "rechtspersoon";
  requireWebsite?: boolean;
  requirePhone?: boolean;
  language: "nl" | "en";
};

export type Address = {
  street?: string | null;
  houseNumber?: string | null;
  houseNumberAddition?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
};

export type DiscoveredBusiness = {
  provider: DiscoveryProvider;
  externalId: string;
  name: string;
  legalName?: string | null;
  kvkNumber?: string | null;
  establishmentNumber?: string | null;
  kvkType?: string | null;
  address: Address;
  lat?: number | null;
  lng?: number | null;
  /** False for Google coordinates (may not be drawn on a non-Google map). */
  coordinatesShareable: boolean;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  categories: string[];
  industry?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  businessStatus?: "active" | "inactive" | "unknown";
  isMock: boolean;
  attribution?: string;
};

export type ProviderPage = {
  provider: DiscoveryProvider;
  results: DiscoveredBusiness[];
  nextCursor: string | null;
  total?: number | null;
  /** Search tasks done / planned (Google tiled search). */
  progress?: { done: number; total: number };
  notice?: string;
};

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
    public retryable = false,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}

/**
 * Golden-record resolution. Each provider's value for each field is stored in
 * business_attributes with provenance and expiry; the visible record on
 * businesses / business_locations is derived here by per-field provider
 * priority. Pure — unit tested.
 */

export type Provider =
  | "kvk" | "google_places" | "osm" | "pdok" | "hunter" | "website_crawl" | "pagespeed" | "openai" | "manual" | "import" | "mock";

export type AttributeRow = {
  attribute: string;
  value: unknown;
  provider: Provider;
  location_id: string | null;
  retrieved_at: string;
  expires_at: string | null;
  verification_status?: string;
};

const P = {
  identity: ["manual", "kvk", "import", "osm", "google_places", "mock"],
  registry: ["manual", "kvk", "mock"],
  industry: ["manual", "kvk", "google_places", "osm", "openai", "mock"],
  website: ["manual", "website_crawl", "kvk", "osm", "google_places", "import", "mock"],
  phone: ["manual", "website_crawl", "osm", "google_places", "import", "mock"],
  address: ["manual", "kvk", "osm", "import", "google_places", "mock"],
  coords: ["manual", "kvk", "osm", "pdok", "google_places", "mock"],
  description: ["manual", "openai", "website_crawl", "mock"],
  rating: ["google_places", "mock"],
} satisfies Record<string, Provider[]>;

export const BUSINESS_FIELDS: Record<string, Provider[]> = {
  name: P.identity,
  legal_name: P.registry,
  legal_form: P.registry,
  kvk_number: P.registry,
  sbi_codes: P.registry,
  primary_sbi_code: P.registry,
  employee_range: P.registry,
  registration_status: ["manual", "kvk", "google_places", "mock"],
  industry: P.industry,
  description: P.description,
  website_url: P.website,
  phone: P.phone,
};

export const LOCATION_FIELDS: Record<string, Provider[]> = {
  name: P.identity,
  street: P.address,
  house_number: P.address,
  house_number_addition: P.address,
  postal_code: P.address,
  city: P.address,
  lat: P.coords,
  lng: P.coords,
  phone: P.phone,
  website_url: P.website,
};

function pick(rows: AttributeRow[], attribute: string, priority: Provider[], now: Date) {
  const candidates = rows.filter(
    (r) => r.attribute === attribute && (!r.expires_at || new Date(r.expires_at) > now) && r.value !== null && r.value !== "" &&
      !(Array.isArray(r.value) && r.value.length === 0) && r.verification_status !== "invalid",
  );
  candidates.sort((a, b) => {
    const pa = priority.indexOf(a.provider);
    const pb = priority.indexOf(b.provider);
    const ra = pa === -1 ? 99 : pa;
    const rb = pb === -1 ? 99 : pb;
    if (ra !== rb) return ra - rb;
    return new Date(b.retrieved_at).getTime() - new Date(a.retrieved_at).getTime();
  });
  return candidates[0];
}

export type Resolved = { values: Record<string, unknown>; sources: Record<string, Provider> };

export function resolveFields(rows: AttributeRow[], fields: Record<string, Provider[]>, now = new Date()): Resolved {
  const values: Record<string, unknown> = {};
  const sources: Record<string, Provider> = {};
  for (const [field, priority] of Object.entries(fields)) {
    const hit = pick(rows, field, priority, now);
    values[field] = hit ? hit.value : null;
    if (hit) sources[field] = hit.provider;
  }
  return { values, sources };
}

export function resolveBusiness(rows: AttributeRow[], now = new Date()) {
  return resolveFields(rows.filter((r) => r.location_id === null), BUSINESS_FIELDS, now);
}

export function resolveLocation(rows: AttributeRow[], locationId: string, now = new Date()) {
  return resolveFields(rows.filter((r) => r.location_id === locationId), LOCATION_FIELDS, now);
}

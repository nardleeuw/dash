import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/server/supabase/admin";
import type { DiscoveredBusiness, DiscoveryProvider } from "@/server/providers/types";
import { getKvk, getOverpass, getPlaces } from "@/server/providers/registry";
import { employeeRange, KVK_ATTRIBUTION, mapBasisprofiel, mapVestiging, type KvkCompanyRecord, type KvkLocationRecord } from "@/server/providers/kvk/map";
import { GOOGLE_ATTRIBUTION, mapPlace } from "@/server/providers/google-places/client";
import { mapOsmElement, OSM_ATTRIBUTION, type OsmElement } from "@/server/providers/osm/client";
import { searchLocations } from "@/server/providers/pdok/client";
import { consumeCredits } from "@/server/usage";
import { findMatch, type IdentityRecord } from "./dedupe";
import { classifyEmail, extractDomain, isPlatformDomain, normalizePostalCode } from "./normalize";
import { resolveBusiness, resolveLocation, type AttributeRow, type Provider } from "./golden";

export type SourceRef = { provider: DiscoveryProvider; externalId: string };
export type ImportGroup = { sources: SourceRef[] };
export type ImportOutcome = { businessId: string | null; status: "created" | "merged" | "failed"; error?: string };

const GOOGLE_RETENTION_DAYS = 30;

type Attr = { attribute: string; value: unknown; provider: Provider; level: "business" | "location"; expiresAt: string | null };
type SourceRow = { provider: Provider; externalId: string | null; raw: unknown; retentionClass: string; expiresAt: string | null; exportable: boolean; attribution: string | null; level: "business" | "location" };

type Built = {
  identity: IdentityRecord;
  isMock: boolean;
  attrs: Attr[];
  sources: SourceRow[];
  tradeNames: { name: string; provider: Provider; primary: boolean }[];
  websites: { url: string; provider: Provider }[];
  emails: { email: string; provider: Provider; sourceUrl?: string }[];
  location: { establishmentNumber: string | null; isMain: boolean; googlePlaceId: string | null; osmId: string | null; geoSource: Provider | null; geoExpiresAt: string | null };
  nonMailing: boolean;
  locationCount: number | null;
  registrationDate: string | null;
  sbiDescriptions: Record<string, string>;
};

/* -------------------------------------------------------------- fetching */
type Fetched = {
  company?: KvkCompanyRecord;
  kvkLocation?: KvkLocationRecord | null;
  kvkRaw?: unknown;
  kvkMock?: boolean;
  locationCount?: number | null;
  google?: DiscoveredBusiness;
  googleMock?: boolean;
  osm?: DiscoveredBusiness;
  osmRaw?: OsmElement;
  osmMock?: boolean;
};

async function fetchGroup(group: ImportGroup, orgId: string): Promise<Fetched> {
  const f: Fetched = {};
  for (const src of group.sources) {
    if (src.provider === "kvk" && !f.company) {
      const kvk = getKvk();
      if (!kvk) continue;
      const [kvkNumber, establishment] = src.externalId.split(":");
      if (!/^\d{8}$/.test(kvkNumber)) continue;
      const profile = await kvk.client.basisprofiel(kvkNumber, orgId);
      if (!profile) continue;
      f.company = mapBasisprofiel(profile);
      f.kvkRaw = profile;
      f.kvkMock = kvk.isMock;
      if (establishment && /^\d{12}$/.test(establishment) && establishment !== f.company.mainLocation?.establishmentNumber) {
        const v = await kvk.client.vestigingsprofiel(establishment, orgId);
        f.kvkLocation = v ? mapVestiging(v) : null;
      } else {
        f.kvkLocation = f.company.mainLocation;
      }
      const list = await kvk.client.vestigingen(kvkNumber, orgId).catch(() => null);
      f.locationCount = list?.totaalAantalVestigingen ?? list?.vestigingen?.length ?? null;
    }
    if (src.provider === "google_places" && !f.google) {
      const places = getPlaces();
      if (!places) continue;
      const p = await places.client.details(src.externalId, orgId);
      if (p) {
        f.google = mapPlace(p, places.isMock);
        f.googleMock = places.isMock;
      }
    }
    if (src.provider === "osm" && !f.osm) {
      const osm = getOverpass();
      const m = src.externalId.match(/^(node|way|relation)\/(\d+)$/);
      if (!osm || !m) continue;
      const elements = await osm.client.query(`[out:json][timeout:15];${m[1]}(${m[2]});out center tags;`, orgId);
      const el = elements.find((e) => `${e.type}/${e.id}` === src.externalId) ?? (osm.isMock ? elements[0] : undefined);
      const mapped = el ? mapOsmElement(el, osm.isMock) : null;
      if (mapped && el) {
        f.osm = { ...mapped, externalId: src.externalId };
        f.osmRaw = el;
        f.osmMock = osm.isMock;
      }
    }
  }
  return f;
}

/* -------------------------------------------------------------- building */
export function buildRecord(f: Fetched, now = new Date()): Built | null {
  const attrs: Attr[] = [];
  const sources: SourceRow[] = [];
  const tradeNames: Built["tradeNames"] = [];
  const websites: Built["websites"] = [];
  const emails: Built["emails"] = [];
  const googleExpiry = new Date(now.getTime() + GOOGLE_RETENTION_DAYS * 86_400_000).toISOString();
  const add = (attribute: string, value: unknown, provider: Provider, level: Attr["level"], expiresAt: string | null = null) => {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return;
    attrs.push({ attribute, value, provider, level, expiresAt });
  };

  const isMock = Boolean(f.kvkMock || f.googleMock || f.osmMock);
  let geoSource: Provider | null = null;
  let geoExpiresAt: string | null = null;

  if (f.company) {
    const c = f.company;
    const p: Provider = f.kvkMock ? "mock" : "kvk";
    add("name", c.name, p, "business");
    add("legal_name", c.legalName, p, "business");
    add("legal_form", c.legalForm, p, "business");
    add("kvk_number", c.kvkNumber, p, "business");
    add("sbi_codes", c.sbiCodes, p, "business");
    add("primary_sbi_code", c.primarySbi, p, "business");
    add("industry", c.industry, p, "business");
    add("employee_range", employeeRange(c.employees), p, "business");
    add("registration_status", "active", p, "business");
    for (const w of c.websites) websites.push({ url: w, provider: p });
    add("website_url", c.websites[0], p, "business");
    c.tradeNames.forEach((n, i) => tradeNames.push({ name: n, provider: p, primary: i === 0 }));
    sources.push({ provider: p, externalId: c.kvkNumber, raw: f.kvkRaw ?? null, retentionClass: "standard", expiresAt: null, exportable: false, attribution: KVK_ATTRIBUTION, level: "business" });
    const loc = f.kvkLocation;
    if (loc) {
      add("name", loc.name, p, "location");
      if (!loc.addressShielded) {
        add("street", loc.street, p, "location");
        add("house_number", loc.houseNumber, p, "location");
        add("house_number_addition", loc.houseNumberAddition, p, "location");
        add("postal_code", loc.postalCode, p, "location");
      }
      add("city", loc.city, p, "location");
      if (loc.lat != null && loc.lng != null) {
        add("lat", loc.lat, p, "location");
        add("lng", loc.lng, p, "location");
        geoSource = p;
      }
      for (const w of loc.websites) websites.push({ url: w, provider: p });
      add("website_url", loc.websites[0], p, "location");
      loc.tradeNames.forEach((n) => tradeNames.push({ name: n, provider: p, primary: false }));
      sources.push({ provider: p, externalId: loc.establishmentNumber, raw: null, retentionClass: "standard", expiresAt: null, exportable: false, attribution: KVK_ATTRIBUTION, level: "location" });
    }
  }

  if (f.osm) {
    const o = f.osm;
    const p: Provider = f.osmMock ? "mock" : "osm";
    add("name", o.name, p, "business");
    add("industry", o.industry, p, "business");
    add("website_url", o.website, p, "business");
    add("phone", o.phone, p, "business");
    add("name", o.name, p, "location");
    add("street", o.address.street, p, "location");
    add("house_number", o.address.houseNumber, p, "location");
    add("postal_code", o.address.postalCode, p, "location");
    add("city", o.address.city, p, "location");
    add("phone", o.phone, p, "location");
    add("website_url", o.website, p, "location");
    if (o.lat != null && o.lng != null && !geoSource) {
      add("lat", o.lat, p, "location");
      add("lng", o.lng, p, "location");
      geoSource = p;
    }
    if (o.website) websites.push({ url: o.website, provider: p });
    if (o.email) emails.push({ email: o.email, provider: p });
    sources.push({ provider: p, externalId: o.externalId, raw: f.osmRaw ?? null, retentionClass: "standard", expiresAt: null, exportable: true, attribution: OSM_ATTRIBUTION, level: "location" });
  }

  if (f.google) {
    const g = f.google;
    const p: Provider = f.googleMock ? "mock" : "google_places";
    // Google content is cached temporarily only; place_id is kept indefinitely.
    const exp = f.googleMock ? null : googleExpiry;
    add("name", g.name, p, "business", exp);
    add("industry", g.industry, p, "business", exp);
    add("website_url", g.website, p, "business", exp);
    add("phone", g.phone, p, "business", exp);
    add("registration_status", g.businessStatus === "inactive" ? "inactive" : null, p, "business", exp);
    add("name", g.name, p, "location", exp);
    add("street", g.address.street, p, "location", exp);
    add("house_number", g.address.houseNumber, p, "location", exp);
    add("postal_code", g.address.postalCode, p, "location", exp);
    add("city", g.address.city, p, "location", exp);
    add("phone", g.phone, p, "location", exp);
    add("website_url", g.website, p, "location", exp);
    add("rating", g.rating, p, "business", exp);
    add("review_count", g.reviewCount, p, "business", exp);
    if (g.lat != null && g.lng != null && !geoSource) {
      add("lat", g.lat, p, "location", exp);
      add("lng", g.lng, p, "location", exp);
      geoSource = p;
      geoExpiresAt = exp;
    }
    if (g.website) websites.push({ url: g.website, provider: p });
    sources.push({ provider: p, externalId: g.externalId, raw: null, retentionClass: f.googleMock ? "standard" : "identifier_only", expiresAt: null, exportable: false, attribution: GOOGLE_ATTRIBUTION, level: "location" });
  }

  const nameAttr = attrs.find((a) => a.attribute === "name");
  if (!nameAttr) return null;

  const postal = attrs.find((a) => a.attribute === "postal_code")?.value as string | undefined;
  const house = attrs.find((a) => a.attribute === "house_number")?.value as string | undefined;
  const website = attrs.find((a) => a.attribute === "website_url")?.value as string | undefined;

  return {
    identity: {
      name: String(nameAttr.value),
      kvkNumber: f.company?.kvkNumber ?? null,
      establishmentNumber: f.kvkLocation?.establishmentNumber ?? null,
      googlePlaceId: f.google?.externalId ?? null,
      osmId: f.osm?.externalId ?? null,
      website: website ?? null,
      postalCode: postal ?? null,
      houseNumber: house ?? null,
      city: (attrs.find((a) => a.attribute === "city")?.value as string) ?? null,
    },
    isMock,
    attrs,
    sources,
    tradeNames,
    websites: dedupeWebsites(websites),
    emails,
    location: {
      establishmentNumber: f.kvkLocation?.establishmentNumber ?? null,
      isMain: f.kvkLocation?.isMain ?? true,
      googlePlaceId: f.google?.externalId ?? null,
      osmId: f.osm?.externalId ?? null,
      geoSource,
      geoExpiresAt,
    },
    nonMailing: f.company?.nonMailing ?? false,
    locationCount: f.locationCount ?? null,
    registrationDate: f.company?.registrationDate ?? null,
    sbiDescriptions: f.company?.sbiDescriptions ?? {},
  };
}

function dedupeWebsites(list: Built["websites"]) {
  const seen = new Map<string, Built["websites"][number]>();
  for (const w of list) {
    const d = extractDomain(w.url);
    if (!d || isPlatformDomain(d) || seen.has(d)) continue;
    seen.set(d, w);
  }
  return [...seen.values()];
}

/* ----------------------------------------------------------- persistence */
async function loadCandidates(admin: SupabaseClient, orgId: string, id: IdentityRecord): Promise<IdentityRecord[]> {
  const ors: string[] = [];
  if (id.establishmentNumber) ors.push(`establishment_number.eq.${id.establishmentNumber}`);
  if (id.googlePlaceId) ors.push(`google_place_id.eq.${id.googlePlaceId}`);
  if (id.osmId) ors.push(`osm_id.eq.${id.osmId}`);
  const pc = normalizePostalCode(id.postalCode);
  if (pc) ors.push(`postal_code.eq.${pc}`);
  const out: IdentityRecord[] = [];
  const select = "id, business_id, name, establishment_number, google_place_id, osm_id, website_url, postal_code, house_number, city, businesses!inner(kvk_number, name, website_url)";
  type Row = {
    id: string; business_id: string; name: string | null; establishment_number: string | null; google_place_id: string | null; osm_id: string | null;
    website_url: string | null; postal_code: string | null; house_number: string | null; city: string | null;
    businesses: { kvk_number: string | null; name: string; website_url: string | null };
  };
  const push = (rows: Row[] | null) => {
    for (const r of rows ?? []) {
      out.push({
        businessId: r.business_id, locationId: r.id, name: r.name ?? r.businesses.name, kvkNumber: r.businesses.kvk_number,
        establishmentNumber: r.establishment_number, googlePlaceId: r.google_place_id, osmId: r.osm_id,
        website: r.website_url ?? r.businesses.website_url, postalCode: r.postal_code, houseNumber: r.house_number, city: r.city,
      });
    }
  };
  if (ors.length) {
    const { data } = await admin.from("business_locations").select(select).eq("org_id", orgId).or(ors.join(",")).limit(50);
    push(data as unknown as Row[]);
  }
  if (id.kvkNumber) {
    const { data } = await admin.from("business_locations").select(select).eq("org_id", orgId).eq("businesses.kvk_number", id.kvkNumber).limit(50);
    push(data as unknown as Row[]);
    const { data: bare } = await admin.from("businesses").select("id, name, website_url").eq("org_id", orgId).eq("kvk_number", id.kvkNumber).limit(1);
    if (bare?.[0] && !out.some((o) => o.businessId === bare[0].id)) out.push({ businessId: bare[0].id, name: bare[0].name, kvkNumber: id.kvkNumber });
  }
  return out;
}

async function upsertAttributes(admin: SupabaseClient, orgId: string, businessId: string, locationId: string, built: Built, sourceIds: Map<string, string>) {
  const { data: existing } = await admin.from("business_attributes").select("id, attribute, provider, location_id").eq("business_id", businessId);
  const key = (a: string, p: string, l: string | null) => `${a}|${p}|${l ?? ""}`;
  const map = new Map((existing ?? []).map((e) => [key(e.attribute, e.provider, e.location_id), e.id as string]));
  const now = new Date().toISOString();
  const inserts: Record<string, unknown>[] = [];
  for (const a of built.attrs) {
    const loc = a.level === "location" ? locationId : null;
    const row = {
      org_id: orgId, business_id: businessId, location_id: loc, attribute: a.attribute, value: a.value as never,
      provider: a.provider, retrieved_at: now, expires_at: a.expiresAt, source_id: sourceIds.get(`${a.provider}|${a.level}`) ?? null,
      verification_status: a.provider === "kvk" ? "verified" : "unverified",
    };
    const id = map.get(key(a.attribute, a.provider, loc));
    if (id) await admin.from("business_attributes").update(row).eq("id", id);
    else inserts.push(row);
  }
  if (inserts.length) {
    const { error } = await admin.from("business_attributes").insert(inserts);
    if (error) throw error;
  }
}

async function upsertSources(admin: SupabaseClient, orgId: string, businessId: string, locationId: string, built: Built) {
  const ids = new Map<string, string>();
  const { data: existing } = await admin.from("business_sources").select("id, provider, external_id, location_id").eq("business_id", businessId);
  for (const s of built.sources) {
    const loc = s.level === "location" ? locationId : null;
    const match = existing?.find((e) => e.provider === s.provider && (e.external_id ?? null) === s.externalId && (e.location_id ?? null) === loc);
    const row = {
      org_id: orgId, business_id: businessId, location_id: loc, provider: s.provider, external_id: s.externalId,
      retrieved_at: new Date().toISOString(), raw: s.raw as never, retention_class: s.retentionClass, expires_at: s.expiresAt,
      is_exportable: s.exportable, attribution: s.attribution,
    };
    if (match) {
      await admin.from("business_sources").update(row).eq("id", match.id);
      ids.set(`${s.provider}|${s.level}`, match.id);
    } else {
      const { data, error } = await admin.from("business_sources").insert(row).select("id").single();
      if (error) throw error;
      ids.set(`${s.provider}|${s.level}`, data.id);
    }
  }
  return ids;
}

/** Re-derive the visible golden record from all non-expired attributes. */
export async function recomputeBusiness(admin: SupabaseClient, orgId: string, businessId: string) {
  const { data: rows } = await admin
    .from("business_attributes")
    .select("attribute, value, provider, location_id, retrieved_at, expires_at, verification_status")
    .eq("org_id", orgId)
    .eq("business_id", businessId);
  const attrs = (rows ?? []) as AttributeRow[];
  const biz = resolveBusiness(attrs);
  const { data: locations } = await admin
    .from("business_locations")
    .select("id, is_main, municipality, province, geo_source")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .order("is_main", { ascending: false });

  let main: Record<string, unknown> | null = null;
  for (const loc of locations ?? []) {
    const r = resolveLocation(attrs, loc.id);
    const v = r.values;
    const update = {
      name: v.name, street: v.street, house_number: v.house_number, house_number_addition: v.house_number_addition,
      postal_code: v.postal_code, city: v.city, lat: v.lat, lng: v.lng, phone: v.phone, website_url: v.website_url,
      geo_source: r.sources.lat ?? null, golden_sources: r.sources,
    };
    await admin.from("business_locations").update(update).eq("id", loc.id);
    if (!main) main = { ...update, municipality: loc.municipality, province: loc.province };
  }

  const v = biz.values;
  const rating = attrs.find((a) => a.attribute === "rating" && (!a.expires_at || new Date(a.expires_at) > new Date()));
  const reviews = attrs.find((a) => a.attribute === "review_count" && (!a.expires_at || new Date(a.expires_at) > new Date()));
  await admin
    .from("businesses")
    .update({
      name: (v.name as string) ?? "—",
      legal_name: v.legal_name, legal_form: v.legal_form, kvk_number: v.kvk_number,
      sbi_codes: (v.sbi_codes as string[]) ?? [], primary_sbi_code: v.primary_sbi_code, employee_range: v.employee_range,
      registration_status: (v.registration_status as string) ?? "unknown", industry: v.industry, description: v.description,
      website_url: v.website_url, domain: extractDomain(v.website_url as string | null), phone: v.phone,
      city: main?.city ?? null, postal_code: main?.postal_code ?? null, municipality: main?.municipality ?? null,
      province: main?.province ?? null, lat: main?.lat ?? null, lng: main?.lng ?? null,
      rating: rating ? Number(rating.value) : null, review_count: reviews ? Number(reviews.value) : null,
      golden_sources: biz.sources,
    })
    .eq("id", businessId)
    .eq("org_id", orgId);
}

async function enrichGeography(admin: SupabaseClient, orgId: string, locationId: string, postalCode: string | null, city: string | null) {
  const q = postalCode ?? city;
  if (!q) return;
  try {
    const hits = await searchLocations(q, 3);
    const hit = hits.find((h) => (postalCode ? h.type === "postcode" : h.type === "woonplaats")) ?? hits[0];
    if (hit) await admin.from("business_locations").update({ municipality: hit.municipality, province: hit.province }).eq("id", locationId).eq("org_id", orgId);
  } catch {
    // Geography enrichment is best-effort.
  }
}

async function persist(admin: SupabaseClient, orgId: string, userId: string | null, built: Built): Promise<{ businessId: string; created: boolean }> {
  const candidates = await loadCandidates(admin, orgId, built.identity);
  const match = findMatch(built.identity, candidates);
  let businessId: string;
  let locationId: string;
  let created = false;

  if (match.kind === "none") {
    const { data, error } = await admin
      .from("businesses")
      .insert({ org_id: orgId, name: built.identity.name, kvk_number: built.identity.kvkNumber, is_mock: built.isMock, created_by: userId })
      .select("id")
      .single();
    if (error) throw error;
    businessId = data.id;
    created = true;
  } else {
    businessId = match.businessId;
  }

  if (match.kind === "location") {
    locationId = match.locationId;
    await admin
      .from("business_locations")
      .update({
        ...(built.location.establishmentNumber ? { establishment_number: built.location.establishmentNumber } : {}),
        ...(built.location.googlePlaceId ? { google_place_id: built.location.googlePlaceId } : {}),
        ...(built.location.osmId ? { osm_id: built.location.osmId } : {}),
        ...(built.location.geoExpiresAt ? { geo_expires_at: built.location.geoExpiresAt } : {}),
      })
      .eq("id", locationId)
      .eq("org_id", orgId);
  } else {
    const { data, error } = await admin
      .from("business_locations")
      .insert({
        org_id: orgId, business_id: businessId, is_main: created ? true : built.location.isMain,
        establishment_number: built.location.establishmentNumber, google_place_id: built.location.googlePlaceId,
        osm_id: built.location.osmId, geo_expires_at: built.location.geoExpiresAt,
      })
      .select("id")
      .single();
    if (error) throw error;
    locationId = data.id;
  }

  const sourceIds = await upsertSources(admin, orgId, businessId, locationId, built);
  await upsertAttributes(admin, orgId, businessId, locationId, built, sourceIds);

  // Trade names
  const { data: tn } = await admin.from("business_trade_names").select("name").eq("business_id", businessId);
  const known = new Set((tn ?? []).map((t) => t.name.toLowerCase()));
  const newNames = built.tradeNames.filter((t) => !known.has(t.name.toLowerCase()) && (known.add(t.name.toLowerCase()), true));
  if (newNames.length) {
    await admin.from("business_trade_names").insert(newNames.map((t) => ({ org_id: orgId, business_id: businessId, name: t.name, is_primary: t.primary, source: t.provider })));
  }

  // Websites
  if (built.websites.length) {
    const { data: existingSites } = await admin.from("websites").select("domain").eq("business_id", businessId);
    const hasPrimary = (existingSites ?? []).length > 0;
    const rows = built.websites
      .map((w, i) => ({ org_id: orgId, business_id: businessId, location_id: locationId, url: w.url, domain: extractDomain(w.url)!, is_primary: !hasPrimary && i === 0, source: w.provider }))
      .filter((r) => !(existingSites ?? []).some((e) => e.domain === r.domain));
    if (rows.length) await admin.from("websites").insert(rows);
  }

  // Published business emails (e.g. OSM contact:email) — stored as contacts with source.
  for (const e of built.emails) {
    const { data: exists } = await admin.from("contacts").select("id").eq("org_id", orgId).eq("email", e.email).maybeSingle();
    if (exists) continue;
    const type = classifyEmail(e.email);
    const { data: contact } = await admin
      .from("contacts")
      .insert({
        org_id: orgId, business_id: businessId, location_id: locationId, email: e.email,
        email_type: type === "generic" ? "generic" : type === "personal" ? "personal" : "unknown",
        recipient_category: type === "generic" ? "legal_entity_generic" : "unknown",
        source: e.provider, is_mock: built.isMock,
      })
      .select("id")
      .single();
    if (contact) await admin.from("contact_sources").insert({ org_id: orgId, contact_id: contact.id, provider: e.provider, source_url: e.sourceUrl ?? null });
  }

  await admin
    .from("businesses")
    .update({
      kvk_non_mailing: built.nonMailing,
      ...(built.locationCount != null ? { location_count: built.locationCount } : {}),
      ...(built.registrationDate ? { registration_date: built.registrationDate } : {}),
      last_enriched_at: new Date().toISOString(),
    })
    .eq("id", businessId)
    .eq("org_id", orgId);

  await recomputeBusiness(admin, orgId, businessId);
  const { data: loc } = await admin.from("business_locations").select("postal_code, city, province").eq("id", locationId).single();
  if (loc && !loc.province) {
    await enrichGeography(admin, orgId, locationId, loc.postal_code, loc.city);
    await recomputeBusiness(admin, orgId, businessId);
  }

  await admin.from("activities").insert({
    org_id: orgId, business_id: businessId, actor_id: userId,
    type: created ? "business_imported" : "business_merged",
    data: { sources: built.sources.map((s) => s.provider), match: match.kind === "none" ? null : match.reason },
  });
  return { businessId, created };
}

/** Import (or merge) one group of provider results describing the same business. */
export async function importGroup(orgId: string, userId: string | null, group: ImportGroup): Promise<ImportOutcome> {
  const admin = createAdminClient();
  try {
    const sorted = [...group.sources].sort((a, b) => a.provider.localeCompare(b.provider) || a.externalId.localeCompare(b.externalId));
    await consumeCredits({
      orgId, kind: "enrichment", userId, referenceType: "import",
      idempotencyKey: `import:${sorted.map((s) => `${s.provider}:${s.externalId}`).join("|")}:${new Date().toISOString().slice(0, 10)}`,
    });
    const fetched = await fetchGroup(group, orgId);
    const built = buildRecord(fetched);
    if (!built) return { businessId: null, status: "failed", error: "no_data" };
    const { businessId, created } = await persist(admin, orgId, userId, built);
    return { businessId, status: created ? "created" : "merged" };
  } catch (err) {
    if ((err as Error).name === "CreditsExhaustedError") throw err;
    console.error("[import]", err);
    return { businessId: null, status: "failed", error: (err as Error).message?.slice(0, 200) };
  }
}

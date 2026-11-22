import { describe, expect, it } from "vitest";
import { resolveBusiness, resolveLocation, type AttributeRow } from "@/server/discovery/golden";
import { buildRecord } from "@/server/discovery/import";
import { mapBasisprofiel } from "@/server/providers/kvk/map";
import fs from "node:fs";
import path from "node:path";

const now = new Date("2026-11-22T12:00:00Z");
const row = (attribute: string, value: unknown, provider: AttributeRow["provider"], extra: Partial<AttributeRow> = {}): AttributeRow => ({
  attribute, value, provider, location_id: null, retrieved_at: "2026-11-01T00:00:00Z", expires_at: null, ...extra,
});

describe("golden record resolution", () => {
  it("prefers KVK for identity and registry data", () => {
    const r = resolveBusiness([row("name", "Zon Tandartsen", "google_places"), row("name", "Tandartspraktijk Zon B.V.", "kvk"), row("legal_form", "BV", "kvk")], now);
    expect(r.values.name).toBe("Tandartspraktijk Zon B.V.");
    expect(r.sources.name).toBe("kvk");
  });

  it("prefers verified website crawl over Google for websites, and manual over everything", () => {
    expect(resolveBusiness([row("website_url", "https://g.nl", "google_places"), row("website_url", "https://w.nl", "website_crawl")], now).values.website_url).toBe("https://w.nl");
    expect(resolveBusiness([row("phone", "+311", "google_places"), row("phone", "+312", "manual")], now).values.phone).toBe("+312");
  });

  it("drops expired values (Google retention) and falls back to other sources or null", () => {
    const rows = [
      row("phone", "+31301234567", "google_places", { expires_at: "2026-11-20T00:00:00Z" }),
      row("website_url", "https://g.nl", "google_places", { expires_at: "2026-11-20T00:00:00Z" }),
      row("website_url", "https://osm.nl", "osm"),
    ];
    const r = resolveBusiness(rows, now);
    expect(r.values.phone).toBeNull();
    expect(r.values.website_url).toBe("https://osm.nl");
  });

  it("resolves per location", () => {
    const rows = [row("city", "Utrecht", "kvk", { location_id: "L1" }), row("city", "Amsterdam", "kvk", { location_id: "L2" })];
    expect(resolveLocation(rows, "L2", now).values.city).toBe("Amsterdam");
  });
});

describe("buildRecord", () => {
  const profile = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/kvk/basisprofiel-68750110.json"), "utf8"));

  it("gives Google content a 30-day expiry but keeps KVK data permanent", () => {
    const company = mapBasisprofiel(profile);
    const built = buildRecord({
      company, kvkLocation: company.mainLocation, kvkRaw: profile,
      google: { provider: "google_places", externalId: "place-1", name: "Donald", address: { city: "Lollum" }, phone: "+31301234567", coordinatesShareable: false, categories: [], isMock: false, lat: 53, lng: 5.5 },
    }, now)!;
    const googlePhone = built.attrs.find((a) => a.attribute === "phone" && a.provider === "google_places");
    expect(googlePhone?.expiresAt).toBe("2026-12-22T12:00:00.000Z");
    expect(built.attrs.filter((a) => a.provider === "kvk").every((a) => a.expiresAt === null)).toBe(true);
    // Google stored as identifier only
    expect(built.sources.find((s) => s.provider === "google_places")).toMatchObject({ retentionClass: "identifier_only", raw: null });
    expect(built.nonMailing).toBe(true);
    expect(built.identity).toMatchObject({ kvkNumber: "68750110", googlePlaceId: "place-1", establishmentNumber: "000037178598" });
  });

  it("does not take coordinates from Google when KVK has none and OSM has some", () => {
    const built = buildRecord({
      osm: { provider: "osm", externalId: "node/1", name: "Bakker", address: {}, lat: 52.1, lng: 5.1, coordinatesShareable: true, categories: [], isMock: false },
      google: { provider: "google_places", externalId: "p", name: "Bakker", address: {}, lat: 52.2, lng: 5.2, coordinatesShareable: false, categories: [], isMock: false },
    }, now)!;
    expect(built.attrs.find((a) => a.attribute === "lat")?.provider).toBe("osm");
    expect(built.location.geoExpiresAt).toBeNull();
  });
});

describe("managedUpdate", () => {
  it("only touches attribute-managed fields and nulls fields whose source vanished", async () => {
    const { managedUpdate } = await import("@/server/discovery/import");
    const out = managedUpdate({ values: { name: "A", phone: null, industry: null }, sources: { name: "kvk" } }, { name: "kvk", phone: "google_places" });
    expect(out).toEqual({ name: "A", phone: null }); // industry was never managed → untouched
  });
});

import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mapBasisprofiel, mapSearchResult, mapVestiging, employeeRange } from "@/server/providers/kvk/map";
import { KvkClient } from "@/server/providers/kvk/client";
import { mapPlace } from "@/server/providers/google-places/client";
import { buildOverpassQuery, mapOsmElement } from "@/server/providers/osm/client";
import { mapDoc, parsePoint } from "@/server/providers/pdok/client";
import { resolveProviderMode } from "@/server/providers/mode";

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/kvk", name), "utf8"));

describe("KVK adapter (recorded test-environment responses)", () => {
  it("maps search results incl. establishment ids", () => {
    const res = fixture("zoeken-test.json");
    const mapped = res.resultaten.map((r: never) => mapSearchResult(r));
    expect(mapped[0]).toMatchObject({ provider: "kvk", kvkNumber: "68750110", name: "Test BV Donald" });
    const branch = mapped.find((m: { establishmentNumber: string | null }) => m.establishmentNumber === "000037178601");
    expect(branch.externalId).toBe("68750110:000037178601");
  });

  it("maps a basisprofiel: legal form, SBI, trade names, non-mailing", () => {
    const c = mapBasisprofiel(fixture("basisprofiel-68750110.json"));
    expect(c.legalForm).toBe("Besloten vennootschap");
    expect(c.sbiCodes).toEqual(["01241"]);
    expect(c.tradeNames).toContain("Test BV Donald Nevenvestiging");
    expect(c.nonMailing).toBe(true); // indNonMailing: "Ja"
    expect(c.mainLocation?.establishmentNumber).toBe("000037178598");
    expect(c.mainLocation?.postalCode).toBe("8823SJ"); // visiting address, not the PO box
    expect(c.registrationDate).toBe("2017-05-19");
  });

  it("maps a vestigingsprofiel with geo data and websites", () => {
    const v = mapVestiging(fixture("vestiging-990064773193.json"));
    expect(v.lat).toBeCloseTo(52.0961, 3);
    expect(v.websites[0]).toBe("https://www.domeinnaam1.nl");
    expect(v.employees).toBe(4);
    expect(v.nonMailing).toBe(false);
  });

  it("buckets employee counts", () => {
    expect(employeeRange(1)).toBe("1");
    expect(employeeRange(12)).toBe("10-19");
    expect(employeeRange(null)).toBeNull();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("calls the API with the apikey header and handles 404 as null", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).apikey).toBe("k");
      return url.includes("12345678") ? new Response('{"fout":[]}', { status: 404 }) : new Response(JSON.stringify(fixture("basisprofiel-68750110.json")));
    });
    vi.stubGlobal("fetch", fetchMock);
    const c = new KvkClient("k", "https://api.kvk.nl/test/api");
    expect(c.isTestEnvironment).toBe(true);
    expect(await c.basisprofiel("12345678")).toBeNull();
    expect((await c.basisprofiel("68750110"))?.kvkNummer).toBe("68750110");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.kvk.nl/test/api/v1/basisprofielen/68750110");
  });

  it("retries on 429 and then succeeds", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } }) : new Response(JSON.stringify(fixture("zoeken-test.json"))))));
    const c = new KvkClient("k", "https://api.kvk.nl/test/api");
    const res = await c.search({ naam: "test" });
    expect(res.totaal).toBe(9);
    expect(n).toBe(2);
  });
});

describe("Google Places mapping", () => {
  it("never marks Google coordinates as shareable on non-Google maps", () => {
    const m = mapPlace({
      id: "abc", displayName: { text: "Tandarts Zon" }, location: { latitude: 52, longitude: 5 }, types: ["dentist"],
      addressComponents: [{ longText: "3511 BT", shortText: "3511 BT", types: ["postal_code"] }, { longText: "Utrecht", shortText: "Utrecht", types: ["locality"] }],
      websiteUri: "https://zon.nl/?utm_source=google", nationalPhoneNumber: "030 123 4567", businessStatus: "OPERATIONAL",
    });
    expect(m.coordinatesShareable).toBe(false);
    expect(m.industry).toBe("dental");
    expect(m.website).toBe("https://zon.nl");
    expect(m.phone).toBe("+31301234567");
    expect(m.address.postalCode).toBe("3511BT");
  });
});

describe("OpenStreetMap adapter", () => {
  it("builds admin-area and radius queries and rejects unsafe filters", () => {
    const q = buildOverpassQuery(['["amenity"="dentist"]'], { kind: "admin", name: 'Den "Haag"', adminLevel: 8 });
    expect(q).toContain('["admin_level"="8"]["name"="Den \\"Haag\\""]');
    expect(buildOverpassQuery(['["shop"="bakery"]'], { kind: "around", lat: 52, lng: 5, radiusM: 999999 })).toContain("around:30000,52,5");
    expect(() => buildOverpassQuery(['["x"="y"];out;'], { kind: "around", lat: 52, lng: 5, radiusM: 1000 })).toThrow();
  });

  it("maps elements with tags and centre coordinates", () => {
    const m = mapOsmElement({ type: "way", id: 7, center: { lat: 52.1, lon: 5.1 }, tags: { name: "Bakkerij Bol", shop: "bakery", "addr:postcode": "3512 AB", "contact:email": "INFO@bol.nl" } });
    expect(m).toMatchObject({ externalId: "way/7", industry: "bakery", lat: 52.1, email: "info@bol.nl", coordinatesShareable: true });
    expect(mapOsmElement({ type: "node", id: 1, tags: {} })).toBeNull();
  });
});

describe("PDOK", () => {
  it("parses WKT points and maps documents", () => {
    expect(parsePoint("POINT(5.16385544 52.08423158)")).toEqual({ lng: 5.16385544, lat: 52.08423158 });
    const d = mapDoc({ id: "gem-1", type: "gemeente", weergavenaam: "Gemeente Utrecht", centroide_ll: "POINT(5.07 52.09)", gemeentenaam: "Utrecht", provincienaam: "Utrecht" });
    expect(d).toMatchObject({ type: "gemeente", name: "Utrecht", province: "Utrecht", lat: 52.09 });
  });
});

describe("provider mode", () => {
  it("uses mocks only outside production", () => {
    expect(resolveProviderMode("kvk", { APP_ENV: "development", MOCK_PROVIDERS: "auto" })).toBe("mock");
    expect(resolveProviderMode("kvk", { APP_ENV: "development", MOCK_PROVIDERS: "auto", KVK_API_KEY: "x" })).toBe("live");
    expect(resolveProviderMode("kvk", { APP_ENV: "production", MOCK_PROVIDERS: "kvk" })).toBe("disabled");
    expect(resolveProviderMode("kvk", { APP_ENV: "production", MOCK_PROVIDERS: "kvk", KVK_API_KEY: "x" })).toBe("live");
    expect(resolveProviderMode("osm", { APP_ENV: "production", MOCK_PROVIDERS: "auto" })).toBe("live");
    expect(resolveProviderMode("hunter", { APP_ENV: "development", MOCK_PROVIDERS: "hunter", HUNTER_API_KEY: "x" })).toBe("mock");
  });
});

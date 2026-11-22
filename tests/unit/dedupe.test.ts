import { describe, expect, it } from "vitest";
import { findMatch, mergeSearchResults, type IdentityRecord } from "@/server/discovery/dedupe";
import type { DiscoveredBusiness } from "@/server/providers/types";

const existing: IdentityRecord[] = [
  { businessId: "b1", locationId: "l1", name: "Bakkerij Jansen B.V.", kvkNumber: "11111111", establishmentNumber: "000000000001", postalCode: "3511BT", houseNumber: "10", website: "https://bakkerijjansen.nl", city: "Utrecht" },
  { businessId: "b2", locationId: "l2", name: "Kapsalon Mooi", googlePlaceId: "place-abc", postalCode: "1011AA", houseNumber: "5", city: "Amsterdam" },
  { businessId: "b3", locationId: "l3", name: "Burgerbar Keten", kvkNumber: "33333333", establishmentNumber: "000000000033", postalCode: "2511AA", houseNumber: "1", website: "https://burgerbar.nl", city: "Den Haag" },
];

describe("findMatch", () => {
  it("matches on establishment number", () => {
    const r = findMatch({ name: "Andere naam", establishmentNumber: "000000000001" }, existing);
    expect(r).toMatchObject({ kind: "location", locationId: "l1", confidence: 1 });
  });

  it("matches on Google place id", () => {
    expect(findMatch({ name: "Kapsalon Mooi", googlePlaceId: "place-abc" }, existing)).toMatchObject({ kind: "location", locationId: "l2" });
  });

  it("treats a new establishment of a known KVK number as the same company, new location", () => {
    const r = findMatch({ name: "Bakkerij Jansen filiaal", kvkNumber: "11111111", establishmentNumber: "000000000002", postalCode: "3512AB" }, existing);
    expect(r).toMatchObject({ kind: "business", businessId: "b1" });
  });

  it("never merges branches with different establishment numbers", () => {
    const r = findMatch({ name: "Burgerbar Keten", kvkNumber: "33333333", establishmentNumber: "000000000099", postalCode: "2511AA", houseNumber: "1" }, existing);
    expect(r.kind).toBe("business"); // same company, but NOT the existing location l3
  });

  it("never merges franchises with different KVK numbers even on the same domain and postcode", () => {
    const r = findMatch({ name: "Burgerbar Keten", kvkNumber: "44444444", postalCode: "2511AA", houseNumber: "1", website: "https://burgerbar.nl" }, existing);
    expect(r.kind).toBe("none");
  });

  it("soft-matches domain + postcode when no identifiers conflict", () => {
    const r = findMatch({ name: "Jansen Brood", website: "www.bakkerijjansen.nl", postalCode: "3511 bt" }, existing);
    expect(r).toMatchObject({ kind: "location", locationId: "l1", reason: "domain+postcode" });
  });

  it("soft-matches name + postcode + house number", () => {
    const r = findMatch({ name: "Kapsalon Mooi", postalCode: "1011AA", houseNumber: "5", osmId: "node/1" }, existing);
    expect(r).toMatchObject({ kind: "location", locationId: "l2" });
  });

  it("does not match when house numbers differ", () => {
    expect(findMatch({ name: "Kapsalon Mooi", postalCode: "1011AA", houseNumber: "7" }, existing).kind).toBe("none");
  });

  it("does not merge on platform domains", () => {
    const list: IdentityRecord[] = [{ businessId: "x", locationId: "y", name: "A", website: "https://facebook.com/a", postalCode: "1234AB" }];
    expect(findMatch({ name: "B", website: "https://facebook.com/a", postalCode: "1234AB" }, list).kind).toBe("none");
  });
});

function result(p: Partial<DiscoveredBusiness> & Pick<DiscoveredBusiness, "provider" | "externalId" | "name">): DiscoveredBusiness {
  return { address: {}, categories: [], coordinatesShareable: p.provider !== "google_places", isMock: false, ...p };
}

describe("mergeSearchResults", () => {
  it("groups the same business found by several providers", () => {
    const merged = mergeSearchResults([
      result({ provider: "google_places", externalId: "g1", name: "Tandartspraktijk Zon", address: { postalCode: "3511BT", houseNumber: "3", city: "Utrecht" }, website: "https://zon.nl", lat: 52, lng: 5 }),
      result({ provider: "osm", externalId: "node/9", name: "Tandartspraktijk Zon", address: { postalCode: "3511 BT", houseNumber: "3", city: "Utrecht" }, lat: 52.1, lng: 5.1 }),
      result({ provider: "kvk", externalId: "12345678", name: "Tandartspraktijk Zon B.V.", kvkNumber: "12345678", address: { city: "Utrecht" } }),
      result({ provider: "google_places", externalId: "g2", name: "Andere Praktijk", address: { postalCode: "3511BT", houseNumber: "9", city: "Utrecht" } }),
    ]);
    expect(merged).toHaveLength(2);
    const zon = merged.find((m) => m.sources.length === 3)!;
    expect(zon.primary.provider).toBe("kvk");
    expect(zon.primary.website).toBe("https://zon.nl");
    // Coordinates taken from OSM (shareable), never from Google.
    expect(zon.primary.lat).toBe(52.1);
  });
});

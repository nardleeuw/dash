import type { GooglePlace, PlacesApi, TextSearchRequest } from "./client";

const g = globalThis as unknown as { __mockPlaces?: Map<string, GooglePlace> };
const cache = (g.__mockPlaces ??= new Map<string, GooglePlace>());

/** Deterministic demo results. Names are prefixed "[Demo]"; websites use the fictional leadwerk-demo.nl domain. */
export class MockPlaces implements PlacesApi {
  async searchText(req: TextSearchRequest) {
    const page = req.pageToken ? Number(req.pageToken) : 0;
    const centre = req.circle ?? (req.rectangle ? { lat: (req.rectangle[0] + req.rectangle[2]) / 2, lng: (req.rectangle[1] + req.rectangle[3]) / 2 } : { lat: 52.09, lng: 5.12 });
    const term = req.textQuery.split(" in ")[0] ?? req.textQuery;
    const city = req.textQuery.split(" in ")[1] ?? "Utrecht";
    const places: GooglePlace[] = Array.from({ length: 20 }, (_, i) => {
      const n = page * 20 + i + 1;
      const slug = `${term}-${city}-${n}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return {
        id: `mock-${slug}`,
        displayName: { text: `[Demo] ${term.charAt(0).toUpperCase() + term.slice(1)} ${city} ${n}` },
        formattedAddress: `Voorbeeldlaan ${n}, 3511 AB ${city}`,
        addressComponents: [
          { longText: "Voorbeeldlaan", shortText: "Voorbeeldlaan", types: ["route"] },
          { longText: String(n), shortText: String(n), types: ["street_number"] },
          { longText: "3511 AB", shortText: "3511 AB", types: ["postal_code"] },
          { longText: city, shortText: city, types: ["locality"] },
        ],
        location: { latitude: centre.lat + ((n * 37) % 100 - 50) / 2000, longitude: centre.lng + ((n * 53) % 100 - 50) / 1500 },
        types: req.includedType ? [req.includedType, "establishment"] : ["establishment"],
        websiteUri: n % 4 === 0 ? undefined : `https://${slug.slice(0, 50).replace(/^-+|-+$/g, "")}.leadwerk-demo.nl`,
        nationalPhoneNumber: `030 ${String(1000000 + n * 7919).slice(0, 7)}`,
        rating: 3.5 + ((n * 7) % 15) / 10,
        userRatingCount: 5 + ((n * 13) % 200),
        businessStatus: "OPERATIONAL",
      };
    });
    places.forEach((p) => cache.set(p.id, p));
    if (cache.size > 5000) cache.delete(cache.keys().next().value!);
    return { places, nextPageToken: page < 2 ? String(page + 1) : null };
  }

  async details(placeId: string) {
    const hit = cache.get(placeId);
    if (hit) return hit;
    const { places } = await this.searchText({ textQuery: "bedrijf in Utrecht", languageCode: "nl" });
    return { ...places[0], id: placeId, displayName: { text: `[Demo] ${placeId.replace(/^mock-/, "").replace(/-/g, " ")}` } };
  }
}

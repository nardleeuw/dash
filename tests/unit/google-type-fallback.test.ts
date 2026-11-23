import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/server/providers/types";

const calls: (string | undefined)[] = [];
vi.mock("@/server/providers/registry", () => ({
  getKvk: () => null,
  getOverpass: () => null,
  getPlaces: () => ({
    isMock: false,
    client: {
      searchText: async (req: { includedType?: string }) => {
        calls.push(req.includedType);
        if (req.includedType === "bogus_type") throw new ProviderError("google_places", "searchText failed with HTTP 400: Invalid included_type: 'bogus_type'", 400, false);
        return { places: [{ id: `p-${calls.length}`, displayName: { text: "Rijschool Test" } }], nextPageToken: null };
      },
    },
  }),
}));
vi.mock("@/server/usage", () => ({ consumeCredits: vi.fn(async () => undefined) }));
vi.mock("@/config/industries", async (orig) => {
  const mod = await orig<typeof import("@/config/industries")>();
  const ind = { ...mod.INDUSTRY_BY_KEY.get("driving_school")!, googleType: "bogus_type" };
  return { ...mod, INDUSTRY_BY_KEY: new Map([["driving_school", ind]]) };
});

describe("Google includedType fallback", () => {
  it("retries without a type Google rejects and remembers it", async () => {
    const { runDiscovery } = await import("@/server/discovery/search");
    const res = await runDiscovery("org", "user", {
      industries: ["driving_school"], locations: [{ type: "city", name: "Utrecht", lat: 52.09, lng: 5.12 }],
      providers: ["google_places"], cursors: {}, language: "nl",
    } as never);
    expect(res.errors).toEqual([]);
    expect(res.pages[0].results.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c === "bogus_type").length).toBeLessThanOrEqual(4); // first attempts only
    expect(calls.at(-1)).toBeUndefined();
  });
});

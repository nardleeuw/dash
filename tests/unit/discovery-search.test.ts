import { describe, expect, it } from "vitest";
import { circleBox, googleTasks, splitBox } from "@/server/discovery/search";
import { INDUSTRIES, googleQueriesFor, industryOptions } from "@/config/industries";

const denBosch = { type: "city" as const, name: "'s-Hertogenbosch", lat: 51.6978, lng: 5.3037 };

describe("tiled Google search", () => {
  it("covers a city with a 3×3 grid per query variant (cafés: café, lunchroom, koffiebar, brunch)", () => {
    const tasks = googleTasks({ locations: [denBosch], industries: ["cafe"], text: undefined, language: "nl" });
    expect(tasks).toHaveLength(4 * 9);
    expect(new Set(tasks.map((t) => t.textQuery))).toEqual(new Set(["café", "lunchroom", "koffiebar", "brunch"]));
    // Query-major: the first 9 tasks cover the whole city with the main query.
    expect(tasks.slice(0, 9).every((t) => t.textQuery === "café")).toBe(true);
    expect(tasks.every((t) => t.includedType === "cafe")).toBe(true);
  });

  it("tiles exactly cover the circle's bounding box", () => {
    const box = circleBox(denBosch.lat, denBosch.lng, 7000);
    const tiles = splitBox(box, 3);
    expect(tiles).toHaveLength(9);
    expect(Math.min(...tiles.map((t) => t[0]))).toBeCloseTo(box[0]);
    expect(Math.max(...tiles.map((t) => t[3]))).toBeCloseTo(box[3]);
    // ~7 km in every direction
    expect((box[2] - box[0]) * 111.32).toBeCloseTo(14, 0);
  });

  it("uses a finer grid for a larger radius and supports free text", () => {
    const tasks = googleTasks({ locations: [{ ...denBosch, type: "radius", radiusKm: 20 }], industries: [], text: "vegan bakkerij", language: "nl" });
    expect(tasks).toHaveLength(16);
    expect(tasks[0].textQuery).toBe("vegan bakkerij");
  });

  it("combines industry and free text and caps the number of tasks", () => {
    const tasks = googleTasks({ locations: [{ type: "nl" }], industries: ["restaurant", "cafe", "bar"], text: "terras", language: "nl" });
    expect(tasks.length).toBeLessThanOrEqual(120);
    expect(tasks[0].textQuery).toBe("restaurant terras");
  });
});

describe("industry taxonomy", () => {
  it("has unique keys, a group and at least one query for every industry", () => {
    expect(new Set(INDUSTRIES.map((i) => i.key)).size).toBe(INDUSTRIES.length);
    expect(INDUSTRIES.length).toBeGreaterThanOrEqual(90);
    for (const i of INDUSTRIES) expect(googleQueriesFor(i, "nl").length).toBeGreaterThan(0);
  });

  it("finds industries by synonym (lunchroom → Cafés, barbier → Kappers)", () => {
    const opts = industryOptions("nl");
    const find = (q: string) => opts.filter((o) => o.label.toLowerCase().includes(q) || o.aliases.some((a) => a.includes(q))).map((o) => o.key);
    expect(find("lunchroom")).toContain("cafe");
    expect(find("barbier")).toContain("hair_salon");
    expect(find("loodgieter")).toContain("plumbing_hvac");
  });

  it("only uses valid Overpass tag filters", () => {
    for (const i of INDUSTRIES) for (const f of i.osm) expect(f).toMatch(/^\["[a-z:_]+"="[a-z_;:]+"\]$/);
  });
});

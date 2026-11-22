import type { OsmElement, OverpassApi } from "./client";

export class MockOverpass implements OverpassApi {
  async query(ql: string): Promise<OsmElement[]> {
    const tag = ql.match(/\["([a-z:_]+)"="([a-z_]+)"\]/);
    const around = ql.match(/around:(\d+),([\d.]+),([\d.]+)/);
    const lat = around ? Number(around[2]) : 52.09;
    const lng = around ? Number(around[3]) : 5.12;
    return Array.from({ length: 12 }, (_, i) => ({
      type: "node" as const,
      id: 900000 + i,
      lat: lat + (i - 6) / 400,
      lon: lng + ((i * 7) % 12 - 6) / 300,
      tags: {
        name: `[Demo] OSM ${tag?.[2] ?? "bedrijf"} ${i + 1}`,
        ...(tag ? { [tag[1]]: tag[2] } : {}),
        "addr:street": "Kaartweg",
        "addr:housenumber": String(i + 1),
        "addr:postcode": "3512 CD",
        "addr:city": "Utrecht",
        ...(i % 3 === 0 ? { website: `https://example.org/osm-demo-${i + 1}` } : {}),
      },
    }));
  }
}

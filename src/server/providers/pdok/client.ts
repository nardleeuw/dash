import "server-only";
import { providerFetch } from "../http";

/** PDOK Locatieserver — free Dutch government geocoder. */
const BASE = "https://api.pdok.nl/bzk/locatieserver/search/v3_1";

export type PdokLocation = {
  id: string;
  type: "provincie" | "gemeente" | "woonplaats" | "postcode";
  label: string;
  name: string;
  province: string | null;
  municipality: string | null;
  lat: number;
  lng: number;
};

type Doc = {
  id: string;
  type: PdokLocation["type"];
  weergavenaam: string;
  centroide_ll?: string;
  provincienaam?: string;
  gemeentenaam?: string;
  woonplaatsnaam?: string;
  postcode?: string;
};

export function parsePoint(wkt?: string): { lat: number; lng: number } | null {
  const m = wkt?.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
  return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
}

export function mapDoc(d: Doc): PdokLocation | null {
  const p = parsePoint(d.centroide_ll);
  if (!p) return null;
  const name =
    d.type === "provincie" ? d.provincienaam ?? d.weergavenaam :
    d.type === "gemeente" ? d.gemeentenaam ?? d.weergavenaam :
    d.type === "woonplaats" ? d.woonplaatsnaam ?? d.weergavenaam.split(",")[0] :
    d.postcode ?? d.weergavenaam;
  return { id: d.id, type: d.type, label: d.weergavenaam, name, province: d.provincienaam ?? null, municipality: d.gemeentenaam ?? null, ...p };
}

export async function searchLocations(q: string, rows = 8): Promise<PdokLocation[]> {
  const query = q.trim().slice(0, 80);
  if (query.length < 2) return [];
  const qs = new URLSearchParams({
    q: query,
    fq: "type:(provincie OR gemeente OR woonplaats OR postcode)",
    fl: "id,type,weergavenaam,centroide_ll,provincienaam,gemeentenaam,woonplaatsnaam,postcode",
    rows: String(rows),
  });
  const res = await providerFetch(`${BASE}/free?${qs}`, { headers: { Accept: "application/json" } }, { provider: "pdok", operation: "search", timeoutMs: 8_000, retries: 1 });
  const json = (await res.json()) as { response?: { docs?: Doc[] } };
  return (json.response?.docs ?? []).map(mapDoc).filter((x): x is PdokLocation => !!x);
}

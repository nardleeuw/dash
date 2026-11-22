/** Dutch provinces with approximate centroids and bounding boxes [south, west, north, east]. */
export type Province = { key: string; name: string; lat: number; lng: number; bbox: [number, number, number, number] };

export const NL_BBOX: [number, number, number, number] = [50.75, 3.31, 53.56, 7.23];
export const NL_CENTER = { lat: 52.13, lng: 5.29 };

export const PROVINCES: Province[] = [
  { key: "groningen", name: "Groningen", lat: 53.22, lng: 6.74, bbox: [53.0, 6.17, 53.56, 7.23] },
  { key: "friesland", name: "Fryslân", lat: 53.11, lng: 5.85, bbox: [52.8, 4.85, 53.5, 6.43] },
  { key: "drenthe", name: "Drenthe", lat: 52.86, lng: 6.62, bbox: [52.6, 6.1, 53.2, 7.1] },
  { key: "overijssel", name: "Overijssel", lat: 52.44, lng: 6.45, bbox: [52.2, 5.8, 52.85, 7.1] },
  { key: "flevoland", name: "Flevoland", lat: 52.53, lng: 5.6, bbox: [52.25, 5.1, 52.87, 6.0] },
  { key: "gelderland", name: "Gelderland", lat: 52.06, lng: 5.94, bbox: [51.73, 5.0, 52.52, 6.83] },
  { key: "utrecht", name: "Utrecht", lat: 52.08, lng: 5.18, bbox: [51.94, 4.78, 52.31, 5.62] },
  { key: "noord-holland", name: "Noord-Holland", lat: 52.58, lng: 4.87, bbox: [52.16, 4.49, 53.19, 5.32] },
  { key: "zuid-holland", name: "Zuid-Holland", lat: 51.99, lng: 4.49, bbox: [51.67, 3.86, 52.33, 5.0] },
  { key: "zeeland", name: "Zeeland", lat: 51.47, lng: 3.84, bbox: [51.2, 3.36, 51.75, 4.3] },
  { key: "noord-brabant", name: "Noord-Brabant", lat: 51.56, lng: 5.2, bbox: [51.22, 4.2, 51.83, 6.04] },
  { key: "limburg", name: "Limburg", lat: 51.21, lng: 5.94, bbox: [50.75, 5.56, 51.78, 6.23] },
];

export const PROVINCE_BY_NAME = new Map(PROVINCES.flatMap((p) => [[p.name.toLowerCase(), p], [p.key, p]]));
PROVINCE_BY_NAME.set("friesland", PROVINCES[1]);

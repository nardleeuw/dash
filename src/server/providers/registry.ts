import "server-only";
import { providerMode } from "./mode";
import { createKvkClient, type KvkApi } from "./kvk/client";
import { MockKvk } from "./kvk/mock";
import { createPlacesClient, type PlacesApi } from "./google-places/client";
import { MockPlaces } from "./google-places/mock";
import { OverpassClient, type OverpassApi } from "./osm/client";
import { MockOverpass } from "./osm/mock";

export type Resolved<T> = { client: T; isMock: boolean } | null;

export function getKvk(): Resolved<KvkApi> {
  const mode = providerMode("kvk");
  if (mode === "disabled") return null;
  if (mode === "mock") return { client: new MockKvk(), isMock: true };
  const c = createKvkClient();
  return c ? { client: c, isMock: false } : null;
}

export function getPlaces(): Resolved<PlacesApi> {
  const mode = providerMode("google_places");
  if (mode === "disabled") return null;
  if (mode === "mock") return { client: new MockPlaces(), isMock: true };
  const c = createPlacesClient();
  return c ? { client: c, isMock: false } : null;
}

export function getOverpass(): Resolved<OverpassApi> {
  const mode = providerMode("osm");
  if (mode === "disabled") return null;
  return mode === "mock" ? { client: new MockOverpass(), isMock: true } : { client: new OverpassClient(), isMock: false };
}

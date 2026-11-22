import "server-only";
import { providerMode } from "./mode";
import { createHunterClient, type HunterApi } from "./hunter/client";
import { MockHunter } from "./hunter/mock";
import type { Resolved } from "./registry";

export function getHunter(): Resolved<HunterApi> {
  const mode = providerMode("hunter");
  if (mode === "disabled") return null;
  if (mode === "mock") return { client: new MockHunter(), isMock: true };
  const c = createHunterClient();
  return c ? { client: c, isMock: false } : null;
}

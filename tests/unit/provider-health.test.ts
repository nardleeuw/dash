import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyHealth, checkProviders } from "@/server/providers/health";
import { resetEnvCache } from "@/server/env";

describe("classifyHealth", () => {
  it("recognises working keys", () => {
    expect(classifyHealth("openai", 200, "{}")).toBe("ok");
    expect(classifyHealth("google_places", 200, "{}")).toBe("ok");
    expect(classifyHealth("hunter", 200, "{}")).toBe("ok");
  });

  it("recognises invalid keys", () => {
    expect(classifyHealth("openai", 401, '{"error":{"code":"invalid_api_key"}}')).toBe("invalid_key");
    expect(classifyHealth("google_places", 400, '{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}')).toBe("invalid_key");
    expect(classifyHealth("hunter", 401, '{"errors":[{"id":"authentication_failed"}]}')).toBe("invalid_key");
  });

  it("recognises missing credit and disabled APIs", () => {
    expect(classifyHealth("openai", 429, '{"error":{"type":"insufficient_quota","code":"credit_balance_exhausted"}}')).toBe("no_credit");
    expect(classifyHealth("google_places", 403, '{"error":{"details":[{"reason":"SERVICE_DISABLED"}]}}')).toBe("not_enabled");
    expect(classifyHealth("google_places", 403, '{"error":{"details":[{"reason":"BILLING_DISABLED"}]}}')).toBe("no_credit");
    expect(classifyHealth("hunter", 429, "{}")).toBe("no_credit");
    expect(classifyHealth("openai", 500, "")).toBe("error");
  });
});

describe("checkProviders", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, { APP_ENV: "development", MOCK_PROVIDERS: "", OPENAI_API_KEY: "sk-test", GOOGLE_MAPS_API_KEY: "g-test", HUNTER_API_KEY: "h-test" });
    resetEnvCache();
  });
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
    vi.unstubAllGlobals();
  });

  it("calls each provider with its own key and reports per provider", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("openai")) return new Response('{"error":{"code":"invalid_api_key"}}', { status: 401 });
      if (url.includes("places.googleapis.com")) return new Response('{"id":"x"}', { status: 200 });
      return new Response('{"data":{"requests":{"searches":{"used":3,"available":25}}}}', { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await checkProviders();
    expect(res).toEqual([
      { provider: "openai", status: "invalid_key" },
      { provider: "google_places", status: "ok" },
      { provider: "hunter", status: "ok", detail: "22/25" },
    ]);
    const googleCall = fetchMock.mock.calls.find(([u]) => String(u).includes("places.googleapis.com"))!;
    expect(googleCall[1]?.headers).toMatchObject({ "X-Goog-Api-Key": "g-test", "X-Goog-FieldMask": "id" });
  });

  it("reports mock and missing keys without calling out", async () => {
    Object.assign(process.env, { MOCK_PROVIDERS: "openai", HUNTER_API_KEY: "" });
    resetEnvCache();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await checkProviders();
    expect(res.find((r) => r.provider === "openai")?.status).toBe("mock");
    expect(res.find((r) => r.provider === "hunter")?.status).toBe("mock"); // non-production without key → mock
    expect(fetchMock).toHaveBeenCalledTimes(1); // only Google
  });
});

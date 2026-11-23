import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const parse = vi.fn();
vi.mock("openai", () => ({ default: class { responses = { parse }; } }));
vi.mock("@/server/usage", () => ({ logApiUsage: vi.fn(async () => undefined) }));

describe("structured() error classification", () => {
  afterEach(() => {
    parse.mockReset();
    vi.resetModules();
  });

  async function run() {
    process.env.MOCK_PROVIDERS = "";
    process.env.OPENAI_API_KEY = "sk-test";
    const { resetEnvCache } = await import("@/server/env");
    resetEnvCache();
    const { structured } = await import("@/server/ai/client");
    return structured({ task: "research", orgId: null, system: "s", user: "u", schema: z.object({ a: z.string() }), schemaName: "x", mock: () => ({ a: "m" }) });
  }

  it("reports an invalid key as invalid_key", async () => {
    parse.mockRejectedValue(Object.assign(new Error("401 Incorrect API key provided"), { status: 401, code: "invalid_api_key" }));
    await expect(run()).rejects.toMatchObject({ name: "AiUnavailableError", reason: "invalid_key" });
  });

  it("reports an exhausted balance as quota", async () => {
    parse.mockRejectedValue(Object.assign(new Error("429"), { status: 429, code: "insufficient_quota", type: "insufficient_quota" }));
    await expect(run()).rejects.toMatchObject({ reason: "quota" });
  });

  it("reports other failures as error", async () => {
    parse.mockRejectedValue(Object.assign(new Error("500"), { status: 500 }));
    await expect(run()).rejects.toMatchObject({ reason: "error" });
  });
});

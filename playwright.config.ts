import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running app + local Supabase.
 * Providers run in mock mode; no real email is ever sent.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "off",
    locale: "nl-NL",
    timezoneId: "Europe/Amsterdam",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 }, launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "pnpm start", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});

import { expect, test } from "@playwright/test";

/**
 * The core journey: sign up → workspace → sender profile → identity → find
 * businesses → import → generate individual emails → review → approve.
 */
test("agency can go from sign-up to an approved, individually written email", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.leadwerk.local`;

  await page.goto("/signup");
  await page.fill("#fullName", "E2E Tester");
  await page.fill("#email", email);
  await page.fill("#password", "supersecret123");
  await page.click("button[type=submit]");
  await page.waitForURL("**/onboarding");
  await page.fill("#name", "E2E Agency");
  await page.click("button[type=submit]");
  await page.waitForURL("**/overview");
  await expect(page.getByRole("heading", { name: /Welkom, E2E/ })).toBeVisible();

  // Sender profile
  await page.goto("/settings?tab=sender");
  await page.getByRole("button", { name: "Dienst toevoegen" }).click();
  await page.getByPlaceholder("Dienst", { exact: true }).fill("AI-receptionist voor praktijken");
  await page.fill("#call_to_action", "een kort gesprek van 15 minuten");
  await page.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByText("Opgeslagen").first()).toBeVisible();

  // Sender identity
  await page.goto("/settings?tab=organization");
  await page.fill("#legal_name", "E2E Agency B.V.");
  await page.fill("#kvk_number", "87654321");
  await page.fill("#postal_address", "Straat 1, 3511 AA Utrecht");
  await page.fill("#privacy_policy_url", "https://e2e.example/privacy");
  await page.getByRole("button", { name: "Opslaan" }).first().click();
  await expect(page.getByText("Opgeslagen").first()).toBeVisible();

  // Discover & import (mock Google Places; KVK test env when available)
  await page.goto("/discover");
  await page.fill("#q", "tandarts");
  await page.getByRole("button", { name: "Zoeken" }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  const boxes = page.locator("table tbody tr button[role=checkbox]:not([disabled])");
  await boxes.nth(0).click();
  await boxes.nth(1).click();
  await page.getByRole("button", { name: "Importeren (2)" }).click();
  await expect(page.getByText(/2 nieuw/)).toBeVisible();

  // Generate individual emails for the imported businesses
  await page.goto("/leads");
  await page.locator("thead button[role=checkbox]").click();
  await page.getByRole("button", { name: "E-mails maken" }).click();
  await page.getByRole("button", { name: "2 e-mails maken" }).click();
  await page.waitForURL("**/emails");

  // Review: wait until generation completed, open and approve one
  await page.goto("/emails");
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Klaar", { exact: true }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 90_000 });
  const subjects = await page.locator("table tbody tr td:nth-child(4) a").allInnerTexts();
  expect(new Set(subjects).size).toBe(subjects.length); // every email is different
  await page.locator("table tbody tr td:nth-child(4) a").first().click();
  await page.waitForURL(/\/emails\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Feitencheck")).toBeVisible();
  await expect(page.getByText("Compliance")).toBeVisible();
  await page.getByRole("button", { name: "Goedkeuren" }).click();
  await expect(page.getByText("Goedgekeurd").first()).toBeVisible();
});

test("unauthenticated visitors are redirected to login", async ({ page }) => {
  await page.goto("/leads");
  await expect(page).toHaveURL(/\/login\?next=%2Fleads/);
});

test("security headers are present", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
});

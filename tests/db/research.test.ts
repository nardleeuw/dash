import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createOrgFor, createTestUser } from "./helpers";
import { DENTIST_CONTACT, DENTIST_HOME, startTestSite } from "../support/test-site";

process.env.MOCK_PROVIDERS = "kvk,google_places,osm,openai,hunter";
process.env.APP_ENV = "development";
process.env.RESEARCH_ALLOW_PRIVATE_HOSTS = "1";

let site: { url: string; close: () => Promise<void> };
let orgId: string;
let userId: string;
let businessId: string;

beforeAll(async () => {
  site = await startTestSite({ "/": { body: DENTIST_HOME }, "/contact": { body: DENTIST_CONTACT } });
  const user = await createTestUser("researcher");
  userId = user.id;
  orgId = await createOrgFor(user, `Research Org ${Date.now()}`);
  await admin.from("agency_profiles").update({ services: [{ name: "AI-receptionist en online afsprakensysteem" }], target_industries: ["dental"] }).eq("org_id", orgId);
  const { data } = await admin
    .from("businesses")
    .insert({ org_id: orgId, name: "Tandartspraktijk Zonnehoek", kvk_number: "12345678", industry: "dental", website_url: site.url, domain: "127.0.0.1", province: "Utrecht" })
    .select("id")
    .single();
  businessId = data!.id;
  await admin.from("websites").insert({ org_id: orgId, business_id: businessId, url: site.url, domain: "127.0.0.1", source: "manual" });
});
afterAll(() => site.close());

describe("research run", () => {
  it("crawls, analyses, scores and enriches one business", async () => {
    const { requestResearch, runResearch } = await import("@/server/research/run");
    // requestResearch dispatches a job; call runResearch directly for determinism.
    const { data: analysis } = await admin.from("website_analyses").insert({ org_id: orgId, business_id: businessId, url: site.url, status: "queued" }).select("id").single();
    const res = await runResearch({ orgId, userId, businessId, analysisId: analysis!.id });
    expect(res).toMatchObject({ status: "completed" });

    const { data: a } = await admin.from("website_analyses").select("status, signals, research, pages, is_mock").eq("id", analysis!.id).single();
    expect(a!.status).toBe("completed");
    expect(a!.signals.hasOnlineBooking).toBe(false);
    expect(a!.signals.hasContactForm).toBe(true);
    expect(a!.research.injectionDetected).toBe(true); // hidden "ignore all previous instructions" text
    expect((a!.pages as unknown[]).length).toBe(2);

    const { data: opps } = await admin.from("opportunities").select("type, is_verified, recommended_service").eq("business_id", businessId);
    const booking = opps!.find((o) => o.type === "online_booking");
    expect(booking).toMatchObject({ is_verified: true, recommended_service: "AI-receptionist en online afsprakensysteem" });

    const { data: b } = await admin.from("businesses").select("lead_score, lead_status, digital_signals, recommended_service, phone, golden_sources").eq("id", businessId).single();
    expect(b!.lead_score).toBeGreaterThan(50);
    expect(b!.lead_status).toBe("enriched");
    expect(b!.digital_signals).toMatchObject({ booking: false, mobile: true });
    expect(b!.golden_sources.phone).toBe("website_crawl");

    const { data: site_ } = await admin.from("websites").select("verification_status, verification_evidence").eq("business_id", businessId).single();
    expect(site_).toMatchObject({ verification_status: "verified", verification_evidence: "kvk_number_on_site" });

    const { data: contacts } = await admin.from("contacts").select("email, source, recipient_category, contact_sources(source_url)").eq("business_id", businessId);
    const info = contacts!.find((c) => c.email === "info@zonnehoek.example");
    // Different domain than the crawled host (127.0.0.1) → not attributed to this business.
    expect(info).toBeUndefined();

    // A second request while one is active is skipped (unique active analysis).
    await admin.from("website_analyses").insert({ org_id: orgId, business_id: businessId, url: site.url, status: "queued" });
    const again = await requestResearch(orgId, userId, [businessId]);
    expect(again).toEqual({ queued: 0, skipped: 1 });
  });

  it("adds Hunter contacts with sources (mock) and suppresses invalid addresses on verification", async () => {
    const { findContactsWithHunter, verifyContactEmail } = await import("@/server/research/contacts");
    await admin.from("businesses").update({ domain: "zonnehoek.example" }).eq("id", businessId);
    const r = await findContactsWithHunter(orgId, userId, businessId);
    expect(r).toMatchObject({ added: 2, total: 2 });
    const { data: c } = await admin.from("contacts").select("id, email, email_type, recipient_category, contact_sources(provider, source_url)").eq("business_id", businessId).eq("email", "info@zonnehoek.example").single();
    expect(c).toMatchObject({ email_type: "generic", recipient_category: "legal_entity_generic" });
    expect((c!.contact_sources as { provider: string }[])[0].provider).toBe("mock");
    const v = await verifyContactEmail(orgId, userId, c!.id);
    expect(v).toEqual({ status: "accept_all" });
  });

  it("re-scores when weights change", async () => {
    const { rescoreOrganization } = await import("@/server/research/run");
    await admin.from("organizations").update({ settings: { scoring_weights: { industry_fit: 0, service_fit: 0, geography: 100, opportunity: 0, digital_gap: 0, data_completeness: 0 }, target_provinces: ["Limburg"] } }).eq("id", orgId);
    const out = await rescoreOrganization(orgId);
    expect(out.rescored).toBe(1);
    const { data: b } = await admin.from("businesses").select("lead_score").eq("id", businessId).single();
    expect(b!.lead_score).toBe(25);
  });
});

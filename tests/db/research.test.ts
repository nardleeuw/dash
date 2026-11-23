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
  site = await startTestSite({
    "/": { body: DENTIST_HOME },
    "/contact": { body: DENTIST_CONTACT },
    "/team": { body: `<html><body><h1>Ons team</h1><p>Dr. Anna Jansen — praktijkhouder</p><p>Vragen? Mail de balie: balie [at] zonnehoek [dot] example</p></body></html>` },
  });
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

  it("finds addresses from website, Hunter, verified web search and Hunter Email Finder; checks MX", async () => {
    const { findBusinessEmails } = await import("@/server/contacts/finder");
    const { verifyContactEmail } = await import("@/server/research/contacts");
    await admin.from("businesses").update({ domain: "zonnehoek.example" }).eq("id", businessId);
    const team = `${site.url}/team`;
    const r = await findBusinessEmails(orgId, userId, businessId, {
      webSearch: async () => ({
        isMock: false,
        findings: {
          emails: [
            { email: "balie@zonnehoek.example", source_url: team, quote: "Mail de balie: balie [at] zonnehoek [dot] example" },
            { email: "verzonnen@zonnehoek.example", source_url: team, quote: "niet echt" }, // not on the page → rejected
            { email: "info@webbureau.example", source_url: team, quote: "x" }, // other company → rejected
          ],
          people: [
            { name: "Dr. Anna Jansen", role: "Praktijkhouder", source_url: team },
            { name: "Piet Verzonnen", role: "Eigenaar", source_url: team }, // not on the page → rejected
          ],
        },
      }),
      acceptsMail: async (d) => d === "zonnehoek.example",
    });
    if ("error" in r) throw new Error(r.error);
    // website: info@ (footer mailto) · Hunter mock: demo.eigenaar@ (+ info@ as extra source) · web: balie@ · finder: anna@
    expect(r.bySource).toEqual({ website: 1, hunter: 1, web: 1, finder: 1 });
    expect(r.added).toBe(4);
    expect(r.notes).toContain("web_rejected:3");

    const { data: rows } = await admin.from("contacts").select("email, email_type, recipient_category, full_name, job_title, contact_sources(provider, source_url, source_detail)").eq("business_id", businessId);
    const by = Object.fromEntries((rows ?? []).map((c) => [c.email, c]));
    expect(by["info@zonnehoek.example"]).toMatchObject({ email_type: "generic", recipient_category: "legal_entity_generic" });
    expect((by["info@zonnehoek.example"].contact_sources as { provider: string }[]).map((x) => x.provider).sort()).toEqual(["mock", "website_crawl"]);
    expect((by["balie@zonnehoek.example"].contact_sources as { provider: string; source_url: string }[])[0]).toMatchObject({ provider: "openai", source_url: team });
    expect(by["anna@zonnehoek.example"]).toMatchObject({ full_name: "Anna Jansen", job_title: "Praktijkhouder", email_type: "personal", recipient_category: "legal_entity_personal" });
    expect(by["verzonnen@zonnehoek.example"]).toBeUndefined();

    // Running again adds nothing new (idempotent) and keeps sources unique.
    const again = await findBusinessEmails(orgId, userId, businessId, { webSearch: async () => null, acceptsMail: async () => true });
    if ("error" in again) throw new Error(again.error);
    expect(again.added).toBe(0);

    const v = await verifyContactEmail(orgId, userId, (await admin.from("contacts").select("id").eq("business_id", businessId).eq("email", "info@zonnehoek.example").single()).data!.id);
    expect(v).toEqual({ status: "accept_all" });
  });

  it("drops addresses whose domain cannot receive mail", async () => {
    const { findBusinessEmails } = await import("@/server/contacts/finder");
    const { data } = await admin.from("businesses").insert({ org_id: orgId, name: "Geen Mail BV", website_url: site.url, domain: "geenmail.example" }).select("id").single();
    const r = await findBusinessEmails(orgId, userId, data!.id, { webSearch: async () => null, acceptsMail: async () => false });
    if ("error" in r) throw new Error(r.error);
    expect(r.total).toBe(0);
    expect(r.notes.some((n) => n.startsWith("no_mx:"))).toBe(true);
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

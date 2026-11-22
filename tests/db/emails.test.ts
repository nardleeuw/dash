import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createOrgFor, createTestUser } from "./helpers";
import { DENTIST_CONTACT, DENTIST_HOME, startTestSite } from "../support/test-site";

process.env.MOCK_PROVIDERS = "kvk,google_places,osm,openai,hunter";
process.env.APP_ENV = "development";
process.env.RESEARCH_ALLOW_PRIVATE_HOSTS = "1";
process.env.JOBS_DISABLED = "1";

let site: { url: string; close: () => Promise<void> };
let orgId: string;
let userId: string;
let profileId: string;
const businessIds: string[] = [];

beforeAll(async () => {
  site = await startTestSite({ "/": { body: DENTIST_HOME.replace(/info@zonnehoek\.example/g, "info@127.0.0.1.nip.io") }, "/contact": { body: DENTIST_CONTACT } });
  const user = await createTestUser("writer");
  userId = user.id;
  orgId = await createOrgFor(user, `Email Org ${Date.now()}`);
  const { data: p } = await admin
    .from("agency_profiles")
    .update({ agency_name: "Studio Noord", services: [{ name: "AI-receptionist en online afsprakensysteem" }], target_industries: ["dental"], call_to_action: "een kort gesprek van 15 minuten", signature: "Met vriendelijke groet,\nNard" })
    .eq("org_id", orgId)
    .select("id")
    .single();
  profileId = p!.id;
  for (const [i, website] of [site.url, null, null].entries()) {
    const { data: b } = await admin.from("businesses").insert({ org_id: orgId, name: `Tandartspraktijk Test ${i}`, industry: "dental", website_url: website, kvk_number: `1234567${i}` }).select("id").single();
    businessIds.push(b!.id);
    await admin.from("contacts").insert({ org_id: orgId, business_id: b!.id, email: `info${i}@praktijk${i}.nl`, email_type: "generic", recipient_category: "legal_entity_generic", source: "manual" });
  }
});
afterAll(() => site.close());

describe("individual email generation", () => {
  it("creates one email per business and generates each individually", async () => {
    const { createBatch, planBatch } = await import("@/server/emails/batch");
    const res = await createBatch({ orgId, userId, businessIds, agencyProfileId: profileId, source: "selection", mode: "missing_only", language: "nl" });
    expect(res).toMatchObject({ queued: 3, skipped: 0 });
    await planBatch({ orgId, batchId: res.batchId });

    const { data: emails } = await admin.from("generated_emails").select("*").eq("batch_id", res.batchId);
    expect(emails).toHaveLength(3);
    for (const e of emails!) {
      expect(e.generation_status).toBe("completed");
      expect(e.subject).toBeTruthy();
      expect(e.recipient_email).toMatch(/^info\d@praktijk\d\.nl$/);
      expect(e.compliance_status).toBe("blocked"); // no documented legal basis yet
      expect((e.compliance_reasons as { code: string }[]).map((r) => r.code)).toContain("no_legal_basis");
    }
    // Every email is individual: the researched business gets evidence from its own website.
    const researched = emails!.find((e) => e.business_id === businessIds[0])!;
    expect(researched.body).toContain("Tandartspraktijk Test 0");
    expect((researched.personalization_evidence as { supported: boolean }[]).some((x) => x.supported)).toBe(true);
    expect(researched.fact_check.passed).toBe(true);
    const subjects = new Set(emails!.map((e) => e.subject));
    expect(subjects.size).toBe(3);

    const { data: batch } = await admin.from("email_generation_batches").select("status").eq("id", res.batchId).single();
    expect(batch!.status).toBe("completed");
    const { count } = await admin.from("usage_records").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("kind", "email_generation");
    expect(count).toBe(3);
  });

  it("never creates duplicates and keeps history on regeneration", async () => {
    const { createBatch, planBatch } = await import("@/server/emails/batch");
    const again = await createBatch({ orgId, userId, businessIds, agencyProfileId: profileId, source: "selection", mode: "missing_only", language: "nl" });
    expect(again).toMatchObject({ queued: 0, skipped: 3 });

    const regen = await createBatch({ orgId, userId, businessIds: [businessIds[0]], agencyProfileId: profileId, source: "regenerate", mode: "regenerate_all", language: "nl" });
    expect(regen.queued).toBe(1);
    await planBatch({ orgId, batchId: regen.batchId });
    const { data: e } = await admin.from("generated_emails").select("id, version, generation_status").eq("business_id", businessIds[0]).single();
    expect(e).toMatchObject({ version: 2, generation_status: "completed" });
    const { count: revisions } = await admin.from("generated_email_revisions").select("id", { count: "exact", head: true }).eq("generated_email_id", e!.id);
    expect(revisions).toBe(1);
    const { count: total } = await admin.from("generated_emails").select("id", { count: "exact", head: true }).eq("org_id", orgId);
    expect(total).toBe(3);
  });

  it("becomes eligible once sender identity, privacy notice and a legal basis are documented", async () => {
    const { evaluateEmailCompliance } = await import("@/server/compliance/evaluate");
    const { data: e } = await admin.from("generated_emails").select("id, recipient_email, business_id").eq("business_id", businessIds[1]).single();
    await admin.from("organizations").update({ legal_name: "Studio Noord B.V.", kvk_number: "87654321", postal_address: "Straat 1, 3511 AA Utrecht", privacy_policy_url: "https://studionoord.nl/privacy" }).eq("id", orgId);
    let res = await evaluateEmailCompliance(orgId, e!.id);
    expect(res!.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["no_legal_basis"]));
    await admin.from("email_permissions").insert({
      org_id: orgId, email: e!.recipient_email, business_id: e!.business_id, basis: "existing_customer", recipient_category: "legal_entity_generic",
      purpose: "Informatie over vergelijkbare diensten", source: "Klantcontract 2025", evidence: "Contract 2025-014", obtained_at: "2025-03-01T00:00:00Z",
    });
    res = await evaluateEmailCompliance(orgId, e!.id);
    // Mock content is a warning at review time; real sending with a real account blocks it.
    expect(res!.eligible).toBe(true);
    expect(res!.basis).toBe("existing_customer");

    await admin.from("suppression_records").insert({ org_id: orgId, email: e!.recipient_email, reason: "objection", source: "test" });
    res = await evaluateEmailCompliance(orgId, e!.id);
    expect(res!.eligible).toBe(false);
  });
});

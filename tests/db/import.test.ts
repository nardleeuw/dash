import { beforeAll, describe, expect, it } from "vitest";
import { admin, createOrgFor, createTestUser } from "./helpers";

// Use mock providers for deterministic, offline imports.
process.env.MOCK_PROVIDERS = "kvk,google_places,osm";
process.env.APP_ENV = "development";

let orgId: string;
let userId: string;
type ImportModule = typeof import("@/server/discovery/import");
let importGroup: ImportModule["importGroup"];
let purgeExpiredData: typeof import("@/server/compliance/retention")["purgeExpiredData"];
let MockPlaces: typeof import("@/server/providers/google-places/mock")["MockPlaces"];

beforeAll(async () => {
  ({ importGroup } = await import("@/server/discovery/import"));
  ({ purgeExpiredData } = await import("@/server/compliance/retention"));
  ({ MockPlaces } = await import("@/server/providers/google-places/mock"));
  const user = await createTestUser("importer");
  userId = user.id;
  orgId = await createOrgFor(user, `Import Org ${Date.now()}`);
});

describe("import pipeline", () => {
  it("imports a KVK company with provenance and merges on re-import", async () => {
    const group = { sources: [{ provider: "kvk" as const, externalId: "91234567:990000000001" }] };
    const first = await importGroup(orgId, userId, group);
    expect(first.status).toBe("created");
    const second = await importGroup(orgId, userId, group);
    expect(second).toMatchObject({ status: "merged", businessId: first.businessId });

    const { data: b } = await admin.from("businesses").select("kvk_number, legal_form, is_mock, golden_sources, sbi_codes").eq("id", first.businessId!).single();
    expect(b).toMatchObject({ kvk_number: "91234567", legal_form: "Besloten vennootschap", is_mock: true });
    expect(b!.golden_sources.name).toBe("mock");
    const { count: locations } = await admin.from("business_locations").select("id", { count: "exact", head: true }).eq("business_id", first.businessId!);
    expect(locations).toBe(1);
    const { count: attrs } = await admin.from("business_attributes").select("id", { count: "exact", head: true }).eq("business_id", first.businessId!);
    expect(attrs).toBeGreaterThan(5);
  });

  it("dedupes Google places by place id and consumes credits idempotently per day", async () => {
    const { places } = await new MockPlaces().searchText({ textQuery: "kapper in Utrecht", languageCode: "nl" });
    const group = { sources: [{ provider: "google_places" as const, externalId: places[0].id }] };
    const a = await importGroup(orgId, userId, group);
    const b = await importGroup(orgId, userId, group);
    expect(a.status).toBe("created");
    expect(b).toMatchObject({ status: "merged", businessId: a.businessId });
    const { data: usage } = await admin.from("usage_records").select("idempotency_key").eq("org_id", orgId).like("idempotency_key", `import:google_places:${places[0].id}%`);
    expect(usage).toHaveLength(1);
  });

  it("purges expired attributes and recomputes the golden record", async () => {
    const { places } = await new MockPlaces().searchText({ textQuery: "bakkerij in Zwolle", languageCode: "nl" });
    const res = await importGroup(orgId, userId, { sources: [{ provider: "google_places", externalId: places[1].id }] });
    const id = res.businessId!;
    const { data: before } = await admin.from("businesses").select("phone").eq("id", id).single();
    expect(before?.phone).toBeTruthy();

    await admin.from("business_attributes").update({ expires_at: "2020-01-01T00:00:00Z" }).eq("business_id", id).eq("attribute", "phone");
    const out = await purgeExpiredData();
    expect(out.purgedAttributes).toBeGreaterThan(0);
    const { data: after } = await admin.from("businesses").select("phone, name").eq("id", id).single();
    expect(after?.phone).toBeNull();
    expect(after?.name).toBeTruthy(); // unaffected fields remain
  });

  it("refuses imports when the enrichment allowance is used up", async () => {
    await admin.from("subscriptions").update({ limit_overrides: { enrichment: 0 } }).eq("org_id", orgId);
    await expect(importGroup(orgId, userId, { sources: [{ provider: "kvk", externalId: "91234599" }] })).rejects.toThrow(/credits exhausted/);
    await admin.from("subscriptions").update({ limit_overrides: {} }).eq("org_id", orgId);
  });
});

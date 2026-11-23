import { describe, expect, it } from "vitest";
import { addMember, admin, createOrgFor, createTestUser, insertBusiness } from "./helpers";

describe("deleting organizations and users", () => {
  it("deletes an organization with members and data (audit trigger does not block the cascade)", async () => {
    const owner = await createTestUser("del-owner");
    const member = await createTestUser("del-member");
    const orgId = await createOrgFor(owner, `Delete Org ${Date.now()}`);
    await addMember(orgId, member, "sales_rep");
    await insertBusiness(orgId, "Te verwijderen BV");

    const { error } = await admin.from("organizations").delete().eq("id", orgId);
    expect(error).toBeNull();

    const [members, businesses, logs] = await Promise.all([
      admin.from("organization_members").select("user_id").eq("org_id", orgId),
      admin.from("businesses").select("id").eq("org_id", orgId),
      admin.from("audit_logs").select("id").eq("org_id", orgId),
    ]);
    expect(members.data).toEqual([]);
    expect(businesses.data).toEqual([]);
    expect(logs.data).toEqual([]);
  });

  it("deletes a user account; the organization keeps an audit entry for the removed membership", async () => {
    const owner = await createTestUser("del-owner2");
    const leaver = await createTestUser("del-leaver");
    const orgId = await createOrgFor(owner, `Keep Org ${Date.now()}`);
    await addMember(orgId, leaver, "viewer");

    const { error } = await admin.auth.admin.deleteUser(leaver.id);
    expect(error).toBeNull();

    const { data: org } = await admin.from("organizations").select("id").eq("id", orgId).single();
    expect(org?.id).toBe(orgId);
    const { data: logs } = await admin.from("audit_logs").select("action").eq("org_id", orgId).eq("entity_type", "organization_members").eq("action", "delete");
    expect(logs?.length).toBe(1);
  });
});

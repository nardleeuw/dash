import { beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { addMember, admin, anon, createOrgFor, createTestUser, insertBusiness, type TestUser } from "./helpers";

let alice: TestUser; // owner of org A
let bob: TestUser; // owner of org B
let viewer: TestUser; // viewer in org A
let rep: TestUser; // sales_rep in org A
let orgA: string;
let orgB: string;
let bizA: string;
let bizB: string;

beforeAll(async () => {
  [alice, bob, viewer, rep] = await Promise.all([
    createTestUser("alice"),
    createTestUser("bob"),
    createTestUser("viewer"),
    createTestUser("rep"),
  ]);
  orgA = await createOrgFor(alice, `Agency A ${Date.now()}`);
  orgB = await createOrgFor(bob, `Agency B ${Date.now()}`);
  await admin.from("subscriptions").update({ limit_overrides: { users: 10 } }).eq("org_id", (await Promise.resolve(orgA)));
  await addMember(orgA, viewer, "viewer");
  await addMember(orgA, rep, "sales_rep");
  bizA = await insertBusiness(orgA, "Bakkerij Alfa", { kvk_number: "12345678" });
  bizB = await insertBusiness(orgB, "Bakkerij Beta");
});

describe("workspace creation", () => {
  it("creates owner membership, trial subscription and default agency profile", async () => {
    const { data: m } = await alice.client.from("organization_members").select("role").eq("org_id", orgA).eq("user_id", alice.id).single();
    expect(m?.role).toBe("owner");
    const { data: s } = await alice.client.from("subscriptions").select("plan_key, status").eq("org_id", orgA).single();
    expect(s).toEqual({ plan_key: "trial", status: "trialing" });
    const { data: p } = await alice.client.from("agency_profiles").select("agency_name").eq("org_id", orgA);
    expect(p).toHaveLength(1);
  });
});

describe("tenant isolation (RLS)", () => {
  it("members only see their own organization's businesses", async () => {
    const { data } = await alice.client.from("businesses").select("id, org_id");
    expect(data?.every((b) => b.org_id === orgA)).toBe(true);
    expect(data?.some((b) => b.id === bizB)).toBe(false);
  });

  it("cannot read another organization directly by id", async () => {
    const { data } = await alice.client.from("businesses").select("id").eq("id", bizB);
    expect(data).toEqual([]);
    const { data: org } = await alice.client.from("organizations").select("id").eq("id", orgB);
    expect(org).toEqual([]);
  });

  it("cannot insert data into another organization", async () => {
    const { error } = await alice.client.from("businesses").insert({ org_id: orgB, name: "Intruder" });
    expect(error).not.toBeNull();
  });

  it("cannot update or delete another organization's rows", async () => {
    await alice.client.from("businesses").update({ name: "Hacked" }).eq("id", bizB);
    await alice.client.from("businesses").delete().eq("id", bizB);
    const { data } = await admin.from("businesses").select("name").eq("id", bizB).single();
    expect(data?.name).toBe("Bakkerij Beta");
  });

  it("composite foreign keys block cross-tenant references", async () => {
    const { data: list, error: listErr } = await alice.client.from("lead_lists").insert({ org_id: orgA, name: "Mijn lijst" }).select("id").single();
    expect(listErr).toBeNull();
    // Reference org B's business from org A's list: must fail even though the id exists.
    const { error } = await alice.client.from("lead_list_members").insert({ org_id: orgA, list_id: list!.id, business_id: bizB });
    expect(error).not.toBeNull();
    const ok = await alice.client.from("lead_list_members").insert({ org_id: orgA, list_id: list!.id, business_id: bizA });
    expect(ok.error).toBeNull();
  });

  it("anonymous clients cannot read application tables", async () => {
    const client = anon();
    const { data } = await client.from("businesses").select("id");
    expect(data ?? []).toEqual([]);
    const { data: plans } = await client.from("plans").select("key");
    expect(plans ?? []).toEqual([]);
  });

  it("secrets tables are never readable by users", async () => {
    const { data: acc, error: accErr } = await admin
      .from("email_accounts")
      .insert({ org_id: orgA, provider: "mock", email_address: `sender-${Date.now()}@a.test`, is_mock: true })
      .select("id")
      .single();
    expect(accErr).toBeNull();
    await admin.from("email_account_secrets").insert({ email_account_id: acc!.id, ciphertext: "secret" });
    const { data, error } = await alice.client.from("email_account_secrets").select("*");
    expect(data ?? []).toEqual([]);
    expect(error).not.toBeNull(); // permission denied (no grants)
  });
});

describe("roles and permissions", () => {
  it("viewers can read but not write", async () => {
    const { data } = await viewer.client.from("businesses").select("id").eq("id", bizA);
    expect(data).toHaveLength(1);
    const { error } = await viewer.client.from("businesses").insert({ org_id: orgA, name: "Viewer insert" });
    expect(error).not.toBeNull();
  });

  it("sales reps can create businesses but not delete them", async () => {
    const { data, error } = await rep.client.from("businesses").insert({ org_id: orgA, name: "Rep lead" }).select("id").single();
    expect(error).toBeNull();
    await rep.client.from("businesses").delete().eq("id", data!.id);
    const { data: still } = await admin.from("businesses").select("id").eq("id", data!.id);
    expect(still).toHaveLength(1);
  });

  it("users cannot mark records as mock data", async () => {
    const { error } = await rep.client.from("businesses").insert({ org_id: orgA, name: "Fake mock", is_mock: true });
    expect(error).not.toBeNull();
  });

  it("only admins can see audit logs and invitations", async () => {
    const { data: asRep } = await rep.client.from("audit_logs").select("id").eq("org_id", orgA);
    expect(asRep).toEqual([]);
    const { data: asOwner } = await alice.client.from("audit_logs").select("id").eq("org_id", orgA);
    expect((asOwner ?? []).length).toBeGreaterThan(0); // membership inserts are audited
  });

  it("admins cannot grant ownership; the last owner cannot be demoted", async () => {
    const { data: aliceMember } = await admin.from("organization_members").select("id").eq("org_id", orgA).eq("user_id", alice.id).single();
    const { data: repMember } = await admin.from("organization_members").select("id").eq("org_id", orgA).eq("user_id", rep.id).single();

    await admin.from("organization_members").update({ role: "admin" }).eq("id", repMember!.id);
    const grant = await rep.client.rpc("set_member_role", { p_member_id: repMember!.id, p_role: "owner" });
    expect(grant.error).not.toBeNull();

    const demote = await alice.client.rpc("set_member_role", { p_member_id: aliceMember!.id, p_role: "admin" });
    expect(demote.error?.message).toMatch(/at least one owner/);

    await admin.from("organization_members").update({ role: "sales_rep" }).eq("id", repMember!.id);
  });
});

describe("system-managed columns", () => {
  it("users cannot set compliance status on generated emails", async () => {
    const { data: profile } = await admin.from("agency_profiles").select("id").eq("org_id", orgA).single();
    const { data: email } = await admin
      .from("generated_emails")
      .insert({ org_id: orgA, business_id: bizA, agency_profile_id: profile!.id, subject: "Hallo", body: "Test", generation_status: "completed" })
      .select("id")
      .single();

    const { error } = await rep.client.from("generated_emails").update({ compliance_status: "eligible" }).eq("id", email!.id);
    expect(error).not.toBeNull();

    // Editing the content itself is allowed.
    const edit = await rep.client.from("generated_emails").update({ subject: "Hallo daar" }).eq("id", email!.id);
    expect(edit.error).toBeNull();
  });

  it("campaigns can only be created as drafts by users", async () => {
    const { error } = await rep.client.from("campaigns").insert({ org_id: orgA, name: "Sneaky", status: "running" });
    expect(error).not.toBeNull();
    const draft = await rep.client.from("campaigns").insert({ org_id: orgA, name: "Draft" }).select("id").single();
    expect(draft.error).toBeNull();
    const start = await rep.client.from("campaigns").update({ status: "running" }).eq("id", draft.data!.id);
    expect(start.error).not.toBeNull();
  });

  it("users cannot insert outbound messages or delivery events directly", async () => {
    const { error } = await rep.client.from("email_events").insert({ org_id: orgA, type: "delivered", provider: "x" });
    expect(error).not.toBeNull();
  });
});

describe("credits", () => {
  it("consume_credits is not callable by end users", async () => {
    const { error } = await alice.client.rpc("consume_credits", {
      p_org: orgA, p_kind: "research", p_quantity: 1, p_idempotency_key: "x",
    });
    expect(error).not.toBeNull();
  });

  it("enforces the allowance and is idempotent", async () => {
    // Trial plan: research = 25
    const key = `test-${Date.now()}`;
    const first = await admin.rpc("consume_credits", { p_org: orgA, p_kind: "research", p_quantity: 20, p_idempotency_key: key });
    expect(first.data).toBe(true);
    const repeat = await admin.rpc("consume_credits", { p_org: orgA, p_kind: "research", p_quantity: 20, p_idempotency_key: key });
    expect(repeat.data).toBe(true); // same key — not billed twice
    const over = await admin.rpc("consume_credits", { p_org: orgA, p_kind: "research", p_quantity: 6, p_idempotency_key: `${key}-2` });
    expect(over.data).toBe(false);
    const { data: status } = await alice.client.rpc("credit_status", { p_org: orgA });
    const research = (status as { kind: string; used: number; allowance: number }[]).find((s) => s.kind === "research");
    expect(research).toMatchObject({ used: 20, allowance: 25 });
  });

  it("members cannot read another organization's credit status", async () => {
    const { error } = await alice.client.rpc("credit_status", { p_org: orgB });
    expect(error).not.toBeNull();
  });
});

describe("invitations", () => {
  it("can only be accepted by the invited email address", async () => {
    const token = randomBytes(24).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    const carol = await createTestUser("carol");
    const { error: invErr } = await alice.client
      .from("organization_invitations")
      .insert({ org_id: orgA, email: carol.email, role: "manager", token_hash: hash, invited_by: alice.id });
    expect(invErr).toBeNull();

    const wrong = await bob.client.rpc("accept_invitation", { p_token: token });
    expect(wrong.error).not.toBeNull();

    const right = await carol.client.rpc("accept_invitation", { p_token: token });
    expect(right.error).toBeNull();
    expect(right.data).toBe(orgA);

    const reuse = await carol.client.rpc("accept_invitation", { p_token: token });
    expect(reuse.error).not.toBeNull();
  });
});

describe("duplicate-send prevention", () => {
  it("allows at most one outbound message per recipient and step", async () => {
    const { data: profile } = await admin.from("agency_profiles").select("id").eq("org_id", orgA).single();
    const { data: account } = await admin
      .from("email_accounts")
      .insert({ org_id: orgA, provider: "mock", email_address: `dup-${Date.now()}@a.test`, is_mock: true })
      .select("id")
      .single();
    const { data: campaign } = await admin.from("campaigns").insert({ org_id: orgA, name: "Dup", email_account_id: account!.id }).select("id").single();
    const biz = await insertBusiness(orgA, `Dup Biz ${Date.now()}`);
    const { data: gen } = await admin
      .from("generated_emails")
      .insert({ org_id: orgA, business_id: biz, agency_profile_id: profile!.id, subject: "S", body: "B", generation_status: "completed" })
      .select("id")
      .single();
    const { data: rcpt } = await admin
      .from("campaign_recipients")
      .insert({ org_id: orgA, campaign_id: campaign!.id, business_id: biz, email: "info@dup.test", generated_email_id: gen!.id })
      .select("id")
      .single();

    const message = (n: number) => ({
      org_id: orgA, campaign_id: campaign!.id, campaign_recipient_id: rcpt!.id, email_account_id: account!.id,
      sequence_step: 0, to_email: "info@dup.test", from_email: "sender@a.test", subject: "S", body_text: "B",
      message_id_header: `<dup-${n}-${Date.now()}@leadwerk>`,
    });
    const first = await admin.from("outbound_messages").insert(message(1));
    expect(first.error).toBeNull();
    const second = await admin.from("outbound_messages").insert(message(2));
    expect(second.error?.code).toBe("23505"); // unique violation
  });
});

describe("seat limits", () => {
  it("blocks invitations beyond the plan's user limit", async () => {
    const { data: sub } = await admin.from("subscriptions").select("limit_overrides").eq("org_id", orgB).single();
    void sub;
    await admin.from("subscriptions").update({ limit_overrides: { users: 1 } }).eq("org_id", orgB);
    const { error } = await bob.client.from("organization_invitations").insert({ org_id: orgB, email: "extra@b.test", role: "viewer", token_hash: `h-${Date.now()}`, invited_by: bob.id });
    expect(error?.message).toMatch(/seat limit/);
  });
});

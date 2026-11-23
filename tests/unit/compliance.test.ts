import { describe, expect, it } from "vitest";
import { checkEligibility, readComplianceSettings, DEFAULT_COMPLIANCE, type EligibilityInput } from "@/server/compliance/eligibility";

const now = new Date("2026-11-22T12:00:00Z");
const ok: EligibilityInput = {
  email: "jan@bakkerij.nl",
  recipientCategory: "legal_entity_personal",
  emailVerification: "valid",
  suppression: null,
  kvkNonMailing: false,
  permissions: [{ basis: "consent", email: "jan@bakkerij.nl", obtained_at: "2026-01-01T00:00:00Z", expires_at: null, revoked_at: null }],
  settings: DEFAULT_COMPLIANCE,
  senderIdentityComplete: true,
  privacyNoticeConfigured: true,
  isMockContent: false,
  now,
};
const codes = (i: EligibilityInput) => checkEligibility(i).reasons.filter((r) => r.severity === "block").map((r) => r.code);
const warns = (i: EligibilityInput) => checkEligibility(i).reasons.filter((r) => r.severity === "warn").map((r) => r.code);

describe("hard eligibility gate", () => {
  it("allows an address with documented consent", () => {
    expect(checkEligibility(ok)).toMatchObject({ eligible: true, basis: "consent" });
  });

  it("allows sending without a documented basis, with a warning — including generic addresses", () => {
    // No documented basis: sent on the sender's responsibility, shown as a warning.
    expect(codes({ ...ok, permissions: [] })).toEqual([]);
    expect(warns({ ...ok, permissions: [] })).toContain("no_legal_basis");
    const generic = checkEligibility({ ...ok, email: "info@bakkerij.nl", recipientCategory: "legal_entity_generic", permissions: [] });
    expect(generic.eligible).toBe(true);
    expect(generic.reasons.find((r) => r.code === "no_legal_basis")?.severity).toBe("warn");
  });

  it("ignores revoked, expired, future or other-address permissions", () => {
    const p = ok.permissions[0];
    expect(warns({ ...ok, permissions: [{ ...p, revoked_at: "2026-06-01T00:00:00Z" }] })).toContain("no_legal_basis");
    expect(warns({ ...ok, permissions: [{ ...p, expires_at: "2026-06-01T00:00:00Z" }] })).toContain("no_legal_basis");
    expect(warns({ ...ok, permissions: [{ ...p, obtained_at: "2027-01-01T00:00:00Z" }] })).toContain("no_legal_basis");
    expect(warns({ ...ok, permissions: [{ ...p, email: "piet@bakkerij.nl" }] })).toContain("no_legal_basis");
  });

  it("only accepts bases enabled by the workspace; exceptions need a justification", () => {
    const exc = { ...ok.permissions[0], basis: "other_statutory_exception" as const, justification: "short" };
    expect(warns({ ...ok, permissions: [exc] })).toContain("no_legal_basis"); // not enabled by default
    const enabled = readComplianceSettings({ compliance: { accepted_bases: ["consent", "other_statutory_exception"] } });
    expect(warns({ ...ok, permissions: [exc], settings: enabled })).toContain("no_legal_basis"); // justification too short
    expect(checkEligibility({ ...ok, permissions: [{ ...exc, justification: "Documented exception because of an existing contract (ref 123)" }], settings: enabled }).eligible).toBe(true);
  });

  it("always blocks suppressed, invalid, KVK non-mailing and missing sender identity", () => {
    expect(codes({ ...ok, suppression: { reason: "unsubscribe" } })).toContain("suppressed");
    expect(codes({ ...ok, emailVerification: "invalid" })).toContain("invalid_address");
    expect(codes({ ...ok, kvkNonMailing: true })).toContain("kvk_non_mailing");
    expect(codes({ ...ok, senderIdentityComplete: false })).toContain("sender_identity");
    expect(checkEligibility({ ...ok, privacyNoticeConfigured: false }).eligible).toBe(true);
    expect(codes({ ...ok, email: null })).toContain("no_recipient");
  });

  it("adds send-time checks: approval, fact-check and mock content", () => {
    expect(codes({ ...ok, sendTime: { reviewApproved: false, factCheckPassed: true, accountIsMock: false } })).toContain("not_approved");
    // Fact-check issues are shown as a warning, they do not block sending.
    const fc = checkEligibility({ ...ok, sendTime: { reviewApproved: true, factCheckPassed: false, accountIsMock: false } });
    expect(fc.eligible).toBe(true);
    expect(fc.reasons.find((r) => r.code === "fact_check")?.severity).toBe("warn");
    expect(codes({ ...ok, isMockContent: true, sendTime: { reviewApproved: true, factCheckPassed: true, accountIsMock: false } })).toContain("mock_content");
    expect(checkEligibility({ ...ok, isMockContent: true, sendTime: { reviewApproved: true, factCheckPassed: true, accountIsMock: true } }).eligible).toBe(true);
  });

  it("can require verified addresses", () => {
    const strict = readComplianceSettings({ compliance: { require_verified_email: true } });
    expect(codes({ ...ok, emailVerification: "unknown", settings: strict })).toContain("unverified_address");
    expect(checkEligibility({ ...ok, emailVerification: "unknown" }).eligible).toBe(true); // warning only by default
  });
});

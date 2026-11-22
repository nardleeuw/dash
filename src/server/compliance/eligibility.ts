/**
 * The hard sending-eligibility gate. Pure and deterministic.
 *
 * Design principles (configurable, conservative defaults):
 *  - Nothing is eligible without a documented legal basis for THIS address:
 *    prior consent, an existing customer relationship (soft opt-in), or a
 *    workspace-enabled "other statutory exception" with written justification.
 *  - Publicly available or generic business addresses (info@…) are NOT
 *    automatically eligible.
 *  - Suppression, objections, invalid addresses and KVK non-mailing always block.
 *  - The sender's identity and a privacy notice must be configured.
 * This encodes product rules, not legal advice; users remain responsible.
 */
export type Basis = "consent" | "existing_customer" | "other_statutory_exception";

export type Permission = {
  basis: Basis;
  email: string;
  obtained_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  justification?: string | null;
};

export type ComplianceSettings = { acceptedBases: Basis[]; requireVerifiedEmail: boolean };

export const DEFAULT_COMPLIANCE: ComplianceSettings = { acceptedBases: ["consent", "existing_customer"], requireVerifiedEmail: false };

export type EligibilityInput = {
  email: string | null;
  recipientCategory: string;
  emailVerification: string;
  suppression: { reason: string } | null;
  kvkNonMailing: boolean;
  permissions: Permission[];
  settings: ComplianceSettings;
  senderIdentityComplete: boolean;
  privacyNoticeConfigured: boolean;
  isMockContent: boolean;
  now?: Date;
  /** Send-time only checks */
  sendTime?: { reviewApproved: boolean; factCheckPassed: boolean; accountIsMock: boolean };
};

export type Reason = { code: string; severity: "block" | "warn"; nl: string; en: string };
export type EligibilityResult = { eligible: boolean; basis: Basis | null; reasons: Reason[] };

const R = (code: string, severity: Reason["severity"], nl: string, en: string): Reason => ({ code, severity, nl, en });

export function checkEligibility(i: EligibilityInput): EligibilityResult {
  const now = i.now ?? new Date();
  const reasons: Reason[] = [];
  const email = i.email?.trim().toLowerCase() ?? null;

  if (!email) reasons.push(R("no_recipient", "block", "Geen e-mailadres voor dit bedrijf.", "No email address for this business."));
  if (i.emailVerification === "invalid" || i.emailVerification === "disposable") {
    reasons.push(R("invalid_address", "block", "Het e-mailadres is ongeldig of tijdelijk.", "The email address is invalid or disposable."));
  } else if (email && i.settings.requireVerifiedEmail && !["valid", "accept_all"].includes(i.emailVerification)) {
    reasons.push(R("unverified_address", "block", "Het e-mailadres is niet geverifieerd (vereist in je compliance-instellingen).", "The email address is not verified (required by your compliance settings)."));
  } else if (email && i.emailVerification === "unknown") {
    reasons.push(R("unverified_address", "warn", "Het e-mailadres is niet geverifieerd.", "The email address has not been verified."));
  }
  if (i.suppression) reasons.push(R("suppressed", "block", `Adres staat op de suppressielijst (${i.suppression.reason}).`, `Address is on the suppression list (${i.suppression.reason}).`));
  if (i.kvkNonMailing) reasons.push(R("kvk_non_mailing", "block", "Het bedrijf heeft bij KVK aangegeven geen ongevraagde reclame te willen ontvangen.", "The business told KVK it does not want unsolicited advertising."));

  const active = i.permissions.filter(
    (p) => p.email.toLowerCase() === email && !p.revoked_at && (!p.expires_at || new Date(p.expires_at) > now) && new Date(p.obtained_at) <= now,
  );
  const usable = active.filter((p) => i.settings.acceptedBases.includes(p.basis) && (p.basis !== "other_statutory_exception" || (p.justification ?? "").trim().length >= 20));
  const order: Basis[] = ["consent", "existing_customer", "other_statutory_exception"];
  const basis = usable.sort((a, b) => order.indexOf(a.basis) - order.indexOf(b.basis))[0]?.basis ?? null;
  if (email && !basis) {
    const generic = i.recipientCategory === "legal_entity_generic";
    reasons.push(R(
      "no_legal_basis", "block",
      `Geen gedocumenteerde toestemming of wettelijke uitzondering voor dit adres${generic ? " (een algemeen bedrijfsadres is niet automatisch toegestaan)" : ""}.`,
      `No documented consent or statutory exception for this address${generic ? " (a generic business address is not automatically allowed)" : ""}.`,
    ));
  }
  if (i.recipientCategory === "unknown" && email) reasons.push(R("unknown_category", "warn", "De ontvangercategorie (persoon, zzp, bedrijf) is onbekend.", "The recipient category (person, sole trader, company) is unknown."));
  if (!i.senderIdentityComplete) reasons.push(R("sender_identity", "block", "Vul je afzendergegevens in (bedrijfsnaam, adres en KVK-nummer) bij Instellingen.", "Complete your sender identity (legal name, address and KVK number) in Settings."));
  if (!i.privacyNoticeConfigured) reasons.push(R("privacy_notice", "block", "Stel een privacyverklaring in bij Instellingen → Compliance.", "Configure a privacy notice in Settings → Compliance."));
  if (i.isMockContent) reasons.push(R("mock_content", i.sendTime && !i.sendTime.accountIsMock ? "block" : "warn", "Deze e-mail bevat demo-inhoud (mock-modus).", "This email contains demo content (mock mode)."));
  if (i.sendTime) {
    if (!i.sendTime.reviewApproved) reasons.push(R("not_approved", "block", "De e-mail is niet goedgekeurd.", "The email has not been approved."));
    if (!i.sendTime.factCheckPassed) reasons.push(R("fact_check", "block", "De feitencheck bevat fouten.", "The fact-check contains errors."));
  }

  return { eligible: !reasons.some((r) => r.severity === "block"), basis, reasons };
}

export function readComplianceSettings(settings: Record<string, unknown> | null | undefined): ComplianceSettings {
  const c = (settings?.compliance ?? {}) as { accepted_bases?: Basis[]; require_verified_email?: boolean };
  const allowed: Basis[] = ["consent", "existing_customer", "other_statutory_exception"];
  const bases = (c.accepted_bases ?? DEFAULT_COMPLIANCE.acceptedBases).filter((b) => allowed.includes(b));
  return { acceptedBases: bases, requireVerifiedEmail: c.require_verified_email ?? DEFAULT_COMPLIANCE.requireVerifiedEmail };
}

export type ContactCandidate = {
  id: string;
  email: string | null;
  full_name: string | null;
  first_name?: string | null;
  job_title: string | null;
  email_type: string;
  email_verification: string;
  is_primary?: boolean;
};

const VERIFY_RANK: Record<string, number> = { valid: 3, accept_all: 2, unknown: 1, webmail: 1, risky: 0, disposable: -5, invalid: -10 };

/** Choose the best recipient for a business. Invalid addresses are never chosen. */
export function pickRecipient(contacts: ContactCandidate[]): ContactCandidate | null {
  const usable = contacts.filter((c) => c.email && c.email_verification !== "invalid" && c.email_verification !== "disposable");
  usable.sort((a, b) => {
    const score = (c: ContactCandidate) => (c.is_primary ? 10 : 0) + (c.email_type === "personal" ? 4 : c.email_type === "generic" ? 2 : 1) + (VERIFY_RANK[c.email_verification] ?? 0);
    return score(b) - score(a);
  });
  return usable[0] ?? null;
}

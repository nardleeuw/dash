/** Normalisation helpers used for matching and storage. Pure functions. */

const LEGAL_FORM_TOKENS = [
  "b.v.", "bv", "n.v.", "nv", "v.o.f.", "vof", "c.v.", "cv", "holding", "stichting", "vereniging",
  "eenmanszaak", "coöperatie", "cooperatie", "u.a.", "ua", "b.a.", "ba", "maatschap", "& co", "en co",
];

export function normalizePostalCode(input?: string | null): string | null {
  if (!input) return null;
  const m = input.toUpperCase().replace(/\s+/g, "").match(/^([1-9][0-9]{3})([A-Z]{2})$/);
  return m ? `${m[1]}${m[2]}` : null;
}

export function formatPostalCode(pc?: string | null) {
  const n = normalizePostalCode(pc);
  return n ? `${n.slice(0, 4)} ${n.slice(4)}` : pc ?? null;
}

/** Dutch phone number → E.164 (+31…) when recognisable. */
export function normalizePhone(input?: string | null): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = "+" + digits.slice(2);
  if (digits.startsWith("+")) return digits.length >= 10 ? digits : null;
  if (digits.startsWith("0") && digits.length === 10) return "+31" + digits.slice(1);
  if (digits.startsWith("31") && digits.length === 11) return "+" + digits;
  return digits.length >= 9 ? digits : null;
}

export function normalizeUrl(input?: string | null): string | null {
  if (!input) return null;
  let raw = input.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  try {
    const u = new URL(raw);
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    // Strip tracking parameters
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|gclid|fbclid)/i.test(p)) u.searchParams.delete(p);
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function extractDomain(input?: string | null): string | null {
  const url = normalizeUrl(input);
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Domains that are never a company's own website. */
const PLATFORM_DOMAINS = [
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "google.com", "goo.gl",
  "business.site", "wixsite.com", "treatwell.nl", "thuisbezorgd.nl", "booking.com", "tripadvisor.com",
  "tripadvisor.nl", "werkspot.nl", "youtube.com", "tiktok.com", "linktr.ee",
];
export function isPlatformDomain(domain?: string | null) {
  if (!domain) return false;
  return PLATFORM_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

export function normalizeName(input?: string | null): string {
  if (!input) return "";
  let s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`"]/g, "")
    .replace(/&/g, " en ");
  for (const token of LEGAL_FORM_TOKENS) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g"), " ");
  }
  return s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeHouseNumber(n?: string | number | null): string | null {
  if (n === null || n === undefined || n === "") return null;
  return String(n).trim().toLowerCase().replace(/\s+/g, "");
}

/** Token-based similarity (Dice coefficient on bigrams), 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bigrams = (s: string) => {
    const out = new Map<string, number>();
    const t = s.replace(/\s/g, "");
    for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const [g, c] of bx) overlap += Math.min(c, by.get(g) ?? 0);
  const total = [...bx.values()].reduce((a, b) => a + b, 0) + [...by.values()].reduce((a, b) => a + b, 0);
  return total ? (2 * overlap) / total : 0;
}

export function isValidKvkNumber(v?: string | null) {
  return !!v && /^[0-9]{8}$/.test(v);
}

export function isValidEstablishmentNumber(v?: string | null) {
  return !!v && /^[0-9]{12}$/.test(v);
}

/** Classify an email address: generic role mailbox vs. personal. */
const GENERIC_LOCALPARTS = [
  "info", "contact", "hallo", "hello", "hoi", "mail", "office", "kantoor", "receptie", "reception",
  "administratie", "admin", "sales", "verkoop", "support", "service", "klantenservice", "boekhouding",
  "finance", "facturen", "factuur", "noreply", "no-reply", "post", "algemeen", "team", "praktijk",
  "afspraken", "afspraak", "planning", "bestellingen", "orders", "jobs", "vacatures", "hr",
];
export function classifyEmail(email: string): "generic" | "personal" | "unknown" {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (!local) return "unknown";
  if (GENERIC_LOCALPARTS.includes(local) || GENERIC_LOCALPARTS.some((g) => local.startsWith(g + ".") || local.startsWith(g + "-"))) return "generic";
  if (/^[a-z]+([.\-_][a-z]+)+$/.test(local)) return "personal";
  return "unknown";
}

/**
 * Business names on Google sometimes carry SEO keywords after a separator:
 * "The AI Agency Nederland | AI Agency | ai agency" → "The AI Agency Nederland".
 */
export function cleanBusinessName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  const first = name.split(/\s+[|•·]\s+/)[0]?.trim();
  return first && first.length >= 2 ? first : name;
}

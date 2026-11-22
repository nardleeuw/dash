import { normalizeForMatch, quoteAppearsIn } from "@/server/ai/sanitize";
import { extractDomain } from "@/server/discovery/normalize";

/**
 * Deterministic fact-check of a generated email against the material it was
 * allowed to use. Issues with severity "error" block approval-by-default.
 */
export type FactIssue = { severity: "error" | "warning"; code: string; message: string };
export type FactCheck = {
  passed: boolean;
  claims: { claim: string; evidence: string; source: string; supported: boolean }[];
  issues: FactIssue[];
};

const SPAM = [/\bgratis\b.*!/i, /100\s*%\s*(garantie|gegarandeerd)/i, /!!+/, /\bklik hier\b/i, /\bnu of nooit\b/i, /\blaatste kans\b/i, /\bgegarandeerd (meer|resultaat)/i, /\bguaranteed\b/i, /\bact now\b/i, /\$\$\$|€€€/];

const LIMITS = { short: [40, 150], medium: [80, 220], long: [120, 300] } as const;

export function factCheckEmail(input: {
  subject: string;
  body: string;
  evidence: { claim: string; evidence: string; source: string }[];
  sourceTexts: string[];        // observations, quotes, signals text, registry values
  hypotheses: string[];
  companyName: string;
  agencyWebsite: string | null;
  agencyTexts: string[];        // agency profile text (numbers about the agency are allowed if present here)
  avoidPhrases: string[];
  length: "short" | "medium" | "long";
}): FactCheck {
  const issues: FactIssue[] = [];
  const corpus = input.sourceTexts.join("\n");
  const agencyCorpus = input.agencyTexts.join("\n");

  const claims = input.evidence.map((e) => {
    const supported = quoteAppearsIn(e.evidence, corpus) || normalizeForMatch(corpus).includes(normalizeForMatch(e.evidence));
    if (!supported) issues.push({ severity: "error", code: "unsupported_claim", message: `Claim not supported by research: “${e.claim.slice(0, 120)}”` });
    return { ...e, supported };
  });

  const text = `${input.subject}\n${input.body}`;
  const bodyNorm = normalizeForMatch(input.body);

  // Numbers/percentages must come from sources or the agency profile.
  for (const m of input.body.matchAll(/(?<![\w.])(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(%|procent|euro|€|klanten|jaar|uur|minuten)?/gi)) {
    const n = m[1];
    if (/^(15|30|10|20)$/.test(n) && /minuten|minutes/i.test(m[2] ?? "")) continue; // CTA durations
    if (!corpus.includes(n) && !agencyCorpus.includes(n)) {
      issues.push({ severity: m[2] ? "error" : "warning", code: "unsupported_number", message: `Number “${m[0].trim()}” does not appear in the research or agency profile` });
    }
  }

  // Hypotheses must not be stated as facts (verbatim reuse is suspicious).
  for (const h of input.hypotheses) {
    const hn = normalizeForMatch(h);
    if (hn.length > 20 && bodyNorm.includes(hn)) issues.push({ severity: "error", code: "hypothesis_as_fact", message: `Hypothesis used verbatim: “${h.slice(0, 100)}”` });
  }

  // Links: only the agency's own domain.
  const agencyDomain = extractDomain(input.agencyWebsite);
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/gi)) {
    const d = extractDomain(m[0]);
    if (!agencyDomain || d !== agencyDomain) issues.push({ severity: "error", code: "foreign_link", message: `Link not allowed: ${m[0]}` });
  }

  for (const p of input.avoidPhrases) {
    if (p.trim() && normalizeForMatch(text).includes(normalizeForMatch(p))) issues.push({ severity: "error", code: "avoided_phrase", message: `Contains avoided phrase “${p}”` });
  }
  for (const re of SPAM) if (re.test(text)) issues.push({ severity: "warning", code: "spam_trigger", message: `Possible spam trigger: ${re.source}` });
  if (/^(re|fwd?):/i.test(input.subject.trim())) issues.push({ severity: "error", code: "deceptive_subject", message: "Subject pretends to be a reply/forward" });
  if (input.subject === input.subject.toUpperCase() && /[A-Z]{4}/.test(input.subject)) issues.push({ severity: "warning", code: "caps_subject", message: "Subject is all caps" });

  const firstWord = normalizeForMatch(input.companyName).split(" ").filter((w) => w.length > 3)[0];
  if (firstWord && !bodyNorm.includes(firstWord)) issues.push({ severity: "warning", code: "not_personalised", message: "Email does not mention the company" });
  if (claims.length === 0) issues.push({ severity: "warning", code: "no_evidence", message: "No company-specific evidence was used" });

  const words = input.body.trim().split(/\s+/).length;
  const [min, max] = LIMITS[input.length];
  if (words < min * 0.7 || words > max * 1.3) issues.push({ severity: "warning", code: "length", message: `Body has ${words} words (target ${min}–${max})` });

  return { passed: !issues.some((i) => i.severity === "error"), claims, issues };
}

/** Blend the model's self-assessment with objective personalisation evidence. */
export function personalizationScore(aiScore: number, check: FactCheck) {
  const supported = check.claims.filter((c) => c.supported).length;
  const objective = Math.min(100, supported * 25 + (check.issues.some((i) => i.code === "not_personalised") ? 0 : 20));
  const ai = Number.isFinite(aiScore) ? Math.max(0, Math.min(100, aiScore)) : 50;
  const penalty = check.issues.filter((i) => i.severity === "error").length * 15;
  return Math.max(0, Math.min(100, Math.round(0.4 * ai + 0.6 * objective - penalty)));
}

import { quoteAppearsIn } from "@/server/ai/sanitize";
import type { ResearchOutput } from "@/server/ai/prompts/research";
import type { EvidenceItem, Opportunity } from "./opportunities";

export type ValidatedResearch = {
  summary: string;
  services: string[];
  targetCustomers: string[];
  observations: { text: string; quote: string; source_url: string; category: string; verified: true }[];
  hypotheses: { text: string; reasoning: string; confidence: number }[];
  aiOpportunities: Opportunity[];
  injectionDetected: boolean;
  rejectedObservations: number;
};

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);

/**
 * Enforce factuality: an AI "observation" survives only if its quote appears
 * verbatim in the crawled page text and its URL is one of the crawled pages.
 * Everything else is demoted to a hypothesis. Opportunities are verified only
 * when backed by surviving observations.
 */
export function validateResearch(out: ResearchOutput, pages: { url: string; text: string; title: string }[]): ValidatedResearch {
  const byUrl = new Map(pages.map((p) => [p.url.replace(/\/$/, ""), `${p.title} ${p.text}`]));
  const allText = pages.map((p) => `${p.title} ${p.text}`).join(" ");
  const kept: ValidatedResearch["observations"] = [];
  const indexMap = new Map<number, number>();
  const hypotheses = out.hypotheses.slice(0, 6).map((h) => ({ text: h.text.slice(0, 400), reasoning: h.reasoning.slice(0, 600), confidence: clamp01(h.confidence) }));
  let rejected = 0;

  out.observations.slice(0, 15).forEach((o, i) => {
    const pageText = byUrl.get(o.source_url.replace(/\/$/, ""));
    const ok = quoteAppearsIn(o.quote, pageText ?? "") || (!pageText && false);
    if (ok) {
      indexMap.set(i, kept.length);
      kept.push({ text: o.text.slice(0, 400), quote: o.quote.slice(0, 240), source_url: o.source_url, category: o.category, verified: true });
    } else {
      rejected++;
      if (quoteAppearsIn(o.quote, allText)) {
        // Right quote, wrong URL: keep as hypothesis rather than guessing the page.
        hypotheses.push({ text: o.text.slice(0, 400), reasoning: "Quote found on the site but not on the cited page.", confidence: 0.6 });
      } else if (hypotheses.length < 10) {
        hypotheses.push({ text: o.text.slice(0, 400), reasoning: "Not confirmed in the analysed website text.", confidence: 0.3 });
      }
    }
  });

  const aiOpportunities: Opportunity[] = out.opportunities.slice(0, 5).map((o) => {
    const support = o.supporting_observations.map((i) => indexMap.get(Math.trunc(i))).filter((i): i is number => i !== undefined);
    const evidence: EvidenceItem[] = support.map((i) => ({ kind: "observation", text: kept[i].text, quote: kept[i].quote, source_url: kept[i].source_url }));
    const verified = !o.based_on_hypothesis && support.length > 0;
    if (!verified) evidence.push({ kind: "hypothesis", text: o.description.slice(0, 300) });
    return {
      type: o.type,
      title: o.title.slice(0, 140),
      description: o.description.slice(0, 600),
      evidence,
      is_verified: verified,
      confidence: verified ? clamp01(o.confidence) : Math.min(0.6, clamp01(o.confidence)),
      recommended_service: o.recommended_service?.slice(0, 120) ?? null,
    };
  });

  return {
    summary: out.summary.slice(0, 1200),
    services: out.services.slice(0, 12).map((s) => s.slice(0, 120)),
    targetCustomers: out.target_customers.slice(0, 6).map((s) => s.slice(0, 120)),
    observations: kept,
    hypotheses: hypotheses.slice(0, 10),
    aiOpportunities,
    injectionDetected: out.injection_attempt_detected,
    rejectedObservations: rejected,
  };
}

/** Merge AI and rule-based opportunities; one per type, keeping the stronger. */
export function mergeOpportunities(ai: Opportunity[], rules: Opportunity[]): Opportunity[] {
  const byType = new Map<string, Opportunity>();
  for (const o of [...rules, ...ai]) {
    const prev = byType.get(o.type);
    if (!prev) {
      byType.set(o.type, o);
      continue;
    }
    const preferAi = ai.includes(o) && (o.is_verified || !prev.is_verified);
    const base = preferAi ? o : prev;
    byType.set(o.type, {
      ...base,
      is_verified: prev.is_verified || o.is_verified,
      confidence: Math.max(prev.confidence, o.confidence),
      evidence: [...base.evidence, ...(base === o ? prev.evidence : o.evidence)].slice(0, 6),
      recommended_service: o.recommended_service ?? prev.recommended_service,
    });
  }
  return [...byType.values()].sort((a, b) => Number(b.is_verified) - Number(a.is_verified) || b.confidence - a.confidence).slice(0, 6);
}

import type { WebsiteSignals } from "@/server/research/signals";
import { matchService, type Opportunity } from "@/server/research/opportunities";

/** Explainable lead scoring (0–100) with configurable weights. Pure. */
export const DEFAULT_WEIGHTS = {
  industry_fit: 20,
  service_fit: 25,
  geography: 10,
  opportunity: 25,
  digital_gap: 10,
  data_completeness: 10,
} as const;
export type ScoreWeights = Record<keyof typeof DEFAULT_WEIGHTS, number>;

export type ScoreFactor = { key: keyof ScoreWeights; weight: number; score: number; reason: string; evidence: string[] };
export type ScoreResult = { total: number; factors: ScoreFactor[]; recommendedService: string | null; weights: ScoreWeights };

export type ScoreInput = {
  business: { industry: string | null; province: string | null; website_url: string | null; phone: string | null; kvk_number: string | null; hasEmailContact: boolean };
  agency: { targetIndustries: string[]; services: { name: string; description?: string | null }[]; targetProvinces: string[] };
  signals: WebsiteSignals | null;
  opportunities: Opportunity[];
  weights?: Partial<ScoreWeights>;
  locale?: "nl" | "en";
};

export function normalizeWeights(w?: Partial<ScoreWeights>): ScoreWeights {
  const out = { ...DEFAULT_WEIGHTS } as ScoreWeights;
  for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof ScoreWeights)[]) {
    const v = w?.[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(0, Math.min(100, Math.round(v)));
  }
  return out;
}

export function scoreLead(input: ScoreInput): ScoreResult {
  const nl = (input.locale ?? "nl") === "nl";
  const weights = normalizeWeights(input.weights);
  const factors: ScoreFactor[] = [];
  const { business: b, agency: a, signals: s } = input;

  // Industry fit
  let industry = 50;
  let industryReason = nl ? "Branche onbekend" : "Industry unknown";
  if (b.industry && a.targetIndustries.length) {
    industry = a.targetIndustries.includes(b.industry) ? 100 : 35;
    industryReason = a.targetIndustries.includes(b.industry) ? (nl ? "Branche valt binnen je doelbranches" : "Industry is one of your target industries") : (nl ? "Branche valt buiten je doelbranches" : "Industry is outside your target industries");
  } else if (b.industry) {
    industry = 60;
    industryReason = nl ? "Geen doelbranches ingesteld" : "No target industries configured";
  }
  factors.push({ key: "industry_fit", weight: weights.industry_fit, score: industry, reason: industryReason, evidence: b.industry ? [b.industry] : [] });

  // Service fit: best opportunity that maps to one of the agency's services
  const matched = input.opportunities
    .map((o) => ({ o, service: o.recommended_service ?? matchService(o.type, a.services) }))
    .filter((x) => x.service);
  const bestMatch = matched.sort((x, y) => Number(y.o.is_verified) - Number(x.o.is_verified) || y.o.confidence - x.o.confidence)[0];
  let service = 20;
  let serviceReason = nl ? "Geen kans gevonden die aansluit op je diensten" : "No opportunity matches your services";
  if (!a.services.length) {
    service = 50;
    serviceReason = nl ? "Stel je diensten in bij het agency-profiel voor een betere score" : "Configure your services in the agency profile for a better score";
  } else if (bestMatch) {
    service = Math.round((bestMatch.o.is_verified ? 70 : 45) + 30 * bestMatch.o.confidence);
    serviceReason = nl ? `Kans “${bestMatch.o.title}” past bij je dienst “${bestMatch.service}”` : `Opportunity “${bestMatch.o.title}” fits your service “${bestMatch.service}”`;
  }
  factors.push({ key: "service_fit", weight: weights.service_fit, score: Math.min(100, service), reason: serviceReason, evidence: bestMatch ? [bestMatch.o.title] : [] });

  // Geography
  let geo = 70;
  let geoReason = nl ? "Geen doelregio ingesteld" : "No target region configured";
  if (a.targetProvinces.length) {
    geo = b.province && a.targetProvinces.includes(b.province) ? 100 : b.province ? 25 : 50;
    geoReason = b.province ? (a.targetProvinces.includes(b.province) ? (nl ? `Gevestigd in doelregio ${b.province}` : `Located in target region ${b.province}`) : (nl ? `${b.province} valt buiten je doelregio` : `${b.province} is outside your target region`)) : nl ? "Provincie onbekend" : "Province unknown";
  }
  factors.push({ key: "geography", weight: weights.geography, score: geo, reason: geoReason, evidence: b.province ? [b.province] : [] });

  // Opportunity strength
  const verified = input.opportunities.filter((o) => o.is_verified);
  const opp = verified.length ? Math.min(100, 60 + verified.length * 12) : input.opportunities.length ? 40 : 10;
  factors.push({
    key: "opportunity", weight: weights.opportunity, score: opp,
    reason: verified.length ? (nl ? `${verified.length} onderbouwde kans(en) gevonden` : `${verified.length} evidence-backed opportunit(ies) found`) : input.opportunities.length ? (nl ? "Alleen hypothesen, geen bevestigde kansen" : "Only hypotheses, no confirmed opportunities") : (nl ? "Geen kansen gevonden" : "No opportunities found"),
    evidence: verified.slice(0, 3).map((o) => o.title),
  });

  // Digital gap (more gaps = more room for an agency)
  let gap = 50;
  const gaps: string[] = [];
  if (s?.reachable) {
    if (!s.https) gaps.push("HTTPS");
    if (!s.mobileViewport) gaps.push(nl ? "mobiel" : "mobile");
    if (!s.hasOnlineBooking) gaps.push(nl ? "online boeken" : "online booking");
    if (!s.hasContactForm) gaps.push(nl ? "contactformulier" : "contact form");
    if (!s.hasLiveChat) gaps.push("chat");
    if (s.outdatedCopyright) gaps.push(nl ? "verouderd" : "outdated");
    gap = Math.min(100, 20 + gaps.length * 16);
  } else if ((s && !s.reachable) || !b.website_url) {
    gap = 80;
    gaps.push(b.website_url ? (nl ? "geen bereikbare website" : "no reachable website") : nl ? "geen website bekend" : "no known website");
  }
  const gapReason = gaps.length
    ? nl ? `Ontbreekt: ${gaps.join(", ")}` : `Missing: ${gaps.join(", ")}`
    : !s ? (nl ? "Website nog niet geanalyseerd" : "Website not analysed yet") : nl ? "Website lijkt digitaal volwassen" : "Website appears digitally mature";
  factors.push({ key: "digital_gap", weight: weights.digital_gap, score: gap, reason: gapReason, evidence: gaps });

  // Data completeness
  const parts = [b.website_url, b.phone, b.kvk_number, b.hasEmailContact ? "email" : null];
  const completeness = Math.round((parts.filter(Boolean).length / parts.length) * 100);
  factors.push({ key: "data_completeness", weight: weights.data_completeness, score: completeness, reason: nl ? `${parts.filter(Boolean).length} van ${parts.length} kerngegevens bekend` : `${parts.filter(Boolean).length} of ${parts.length} key data points known`, evidence: [] });

  const totalWeight = factors.reduce((acc, f) => acc + f.weight, 0) || 1;
  const total = Math.round(factors.reduce((acc, f) => acc + f.weight * f.score, 0) / totalWeight);
  return { total: Math.max(0, Math.min(100, total)), factors, recommendedService: bestMatch?.service ?? null, weights };
}

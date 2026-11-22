import type { WebsiteSignals } from "./signals";

export const OPPORTUNITY_TYPES = [
  "online_booking", "website_redesign", "mobile_optimization", "performance", "seo", "lead_capture", "quote_automation",
  "ai_receptionist", "chatbot", "online_ordering", "whatsapp_automation", "email_automation", "crm_automation",
  "review_management", "analytics_tracking", "security_ssl", "content", "other",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export type EvidenceItem = { kind: "observation" | "signal" | "hypothesis"; text: string; source_url?: string | null; quote?: string | null };

export type Opportunity = {
  type: OpportunityType;
  title: string;
  description: string;
  evidence: EvidenceItem[];
  is_verified: boolean;
  confidence: number;
  recommended_service: string | null;
};

const BOOKING_INDUSTRIES = ["dental", "general_practice", "physiotherapy", "veterinary", "hair_salon", "beauty_salon", "fitness", "driving_school", "restaurant", "optician"];
const QUOTE_INDUSTRIES = ["plumbing_hvac", "electrician", "construction", "roofing", "painter", "cleaning", "gardening", "car_repair"];
const ORDER_INDUSTRIES = ["restaurant", "cafe", "bakery", "florist"];
const PHONE_HEAVY = ["dental", "general_practice", "physiotherapy", "veterinary", "hair_salon", "beauty_salon", "real_estate", "plumbing_hvac", "car_repair", "legal", "accounting"];

type L = "nl" | "en";
const T = (l: L, nl: string, en: string) => (l === "nl" ? nl : en);

/**
 * Deterministic opportunities from verified website signals. Statements about
 * absence are phrased as what was checked ("not found on the N pages we
 * analysed"), never as a claim about the whole business.
 */
export function ruleOpportunities(industry: string | null, s: WebsiteSignals | null, pagesChecked: string[], locale: L = "nl"): Opportunity[] {
  if (!s || !s.reachable) {
    return [{
      type: "website_redesign",
      title: T(locale, "Geen bereikbare website gevonden", "No reachable website found"),
      description: T(locale, "Er is geen website gevonden of de website was niet bereikbaar tijdens de analyse.", "No website was found or it could not be reached during the analysis."),
      evidence: [{ kind: "signal", text: T(locale, "Website niet bereikbaar of niet bekend", "Website unreachable or unknown") }],
      is_verified: false,
      confidence: 0.4,
      recommended_service: null,
    }];
  }
  const checked = T(locale, `op de ${pagesChecked.length} onderzochte pagina's`, `on the ${pagesChecked.length} pages analysed`);
  const home = pagesChecked[0] ?? null;
  const out: Opportunity[] = [];
  const push = (o: Omit<Opportunity, "evidence"> & { evidence: string }) =>
    out.push({ ...o, evidence: [{ kind: "signal", text: o.evidence, source_url: home }] });

  if (!s.https) push({ type: "security_ssl", title: T(locale, "Website zonder HTTPS", "Website without HTTPS"), description: T(locale, "De website wordt niet volledig via een beveiligde verbinding geladen.", "The website is not fully served over a secure connection."), evidence: T(locale, "Geen HTTPS-verbinding gedetecteerd", "No HTTPS connection detected"), is_verified: true, confidence: 0.95, recommended_service: null });
  if (!s.mobileViewport) push({ type: "mobile_optimization", title: T(locale, "Niet geoptimaliseerd voor mobiel", "Not optimised for mobile"), description: T(locale, "De homepage heeft geen responsive viewport-instelling; op telefoons kan de site slecht leesbaar zijn.", "The homepage has no responsive viewport setting; it may be hard to read on phones."), evidence: T(locale, "Geen viewport-meta met width=device-width op de homepage", "No viewport meta with width=device-width on the homepage"), is_verified: true, confidence: 0.85, recommended_service: null });
  if (industry && BOOKING_INDUSTRIES.includes(industry) && !s.hasOnlineBooking) push({ type: "online_booking", title: T(locale, "Geen online afspraak maken gevonden", "No online booking found"), description: T(locale, `Er is ${checked} geen online boekings- of afsprakensysteem gevonden. Klanten moeten waarschijnlijk bellen of mailen.`, `No online booking or scheduling system was found ${checked}. Customers likely have to call or email.`), evidence: T(locale, `Geen boekingswidget of boekingslink ${checked}`, `No booking widget or link ${checked}`), is_verified: true, confidence: 0.75, recommended_service: null });
  if (industry && QUOTE_INDUSTRIES.includes(industry) && !s.hasQuoteForm) push({ type: "quote_automation", title: T(locale, "Geen online offerteaanvraag", "No online quote request"), description: T(locale, `Er is ${checked} geen formulier gevonden om een offerte aan te vragen.`, `No quote request form was found ${checked}.`), evidence: T(locale, `Geen offerteformulier ${checked}`, `No quote form ${checked}`), is_verified: true, confidence: 0.7, recommended_service: null });
  if (industry && ORDER_INDUSTRIES.includes(industry) && !s.hasOnlineOrdering) push({ type: "online_ordering", title: T(locale, "Geen online bestellen gevonden", "No online ordering found"), description: T(locale, `Er is ${checked} geen online bestel- of bezorgmogelijkheid gevonden.`, `No online ordering or delivery option was found ${checked}.`), evidence: T(locale, `Geen bestelplatform ${checked}`, `No ordering platform ${checked}`), is_verified: true, confidence: 0.65, recommended_service: null });
  if (!s.hasContactForm && !s.hasLiveChat && !s.hasWhatsApp) push({ type: "lead_capture", title: T(locale, "Beperkte manieren om contact op te nemen", "Limited ways to get in touch"), description: T(locale, `Er is ${checked} geen contactformulier, chat of WhatsApp-knop gevonden.`, `No contact form, chat or WhatsApp button was found ${checked}.`), evidence: T(locale, `Geen formulier/chat ${checked}`, `No form/chat ${checked}`), is_verified: true, confidence: 0.7, recommended_service: null });
  if (industry && PHONE_HEAVY.includes(industry) && !s.hasLiveChat) push({ type: "ai_receptionist", title: T(locale, "Klantvragen lopen waarschijnlijk via telefoon", "Enquiries likely go through the phone"), description: T(locale, "Er is geen chat of automatische vraagafhandeling gevonden. Of dit tot gemiste oproepen leidt, is niet bekend — een AI-receptionist of chatbot kan dat ondervangen.", "No chat or automated enquiry handling was found. Whether this leads to missed calls is unknown — an AI receptionist or chatbot could address it."), evidence: T(locale, `Geen chatwidget ${checked}`, `No chat widget ${checked}`), is_verified: false, confidence: 0.5, recommended_service: null });
  if (s.outdatedCopyright) push({ type: "website_redesign", title: T(locale, "Website mogelijk verouderd", "Website may be outdated"), description: T(locale, `De copyrightvermelding noemt ${s.copyrightYear}. Dat kan erop wijzen dat de site lang niet is bijgewerkt (hypothese).`, `The copyright notice says ${s.copyrightYear}. This may indicate the site hasn't been updated in a while (hypothesis).`), evidence: `© ${s.copyrightYear}`, is_verified: false, confidence: 0.45, recommended_service: null });
  if (!s.hasAnalytics) push({ type: "analytics_tracking", title: T(locale, "Geen websitestatistieken gedetecteerd", "No website analytics detected"), description: T(locale, "Er is geen analytics- of trackingscript gevonden; het bedrijf meet mogelijk niet hoe bezoekers de site gebruiken.", "No analytics or tracking script was found; the business may not measure how visitors use the site."), evidence: T(locale, "Geen analytics-script gevonden", "No analytics script found"), is_verified: true, confidence: 0.6, recommended_service: null });
  return out;
}

/** Keywords that connect an opportunity type to an agency's services. */
export const SERVICE_KEYWORDS: Record<OpportunityType, string[]> = {
  online_booking: ["boek", "afspra", "booking", "reserv", "agenda", "planning", "website", "ai"],
  website_redesign: ["website", "webdesign", "redesign", "site", "wordpress", "webflow", "ontwerp"],
  mobile_optimization: ["mobiel", "mobile", "responsive", "website", "webdesign"],
  performance: ["snelheid", "speed", "performance", "website", "hosting", "seo"],
  seo: ["seo", "vindbaar", "google", "marketing", "content"],
  lead_capture: ["lead", "formulier", "conversie", "website", "chat", "marketing"],
  quote_automation: ["offerte", "quote", "automatis", "automation", "workflow", "ai"],
  ai_receptionist: ["receptionist", "telefoon", "voice", "bellen", "call", "ai", "assistent"],
  chatbot: ["chat", "bot", "ai", "assistent", "klantenservice"],
  online_ordering: ["bestel", "order", "webshop", "e-commerce", "ecommerce"],
  whatsapp_automation: ["whatsapp", "chat", "automatis", "ai"],
  email_automation: ["email", "e-mail", "nieuwsbrief", "automatis", "marketing"],
  crm_automation: ["crm", "automatis", "workflow", "proces", "integratie"],
  review_management: ["review", "reputatie", "google", "marketing"],
  analytics_tracking: ["analytics", "data", "tracking", "marketing", "seo"],
  security_ssl: ["ssl", "beveilig", "hosting", "website", "onderhoud"],
  content: ["content", "tekst", "copy", "marketing", "seo"],
  other: [],
};

export function matchService(type: OpportunityType, services: { name: string; description?: string | null }[]): string | null {
  const keys = SERVICE_KEYWORDS[type] ?? [];
  let best: { name: string; hits: number } | null = null;
  for (const s of services) {
    const hay = `${s.name} ${s.description ?? ""}`.toLowerCase();
    const hits = keys.filter((k) => hay.includes(k)).length;
    if (hits > 0 && hits > (best?.hits ?? 0)) best = { name: s.name, hits };
  }
  return best?.name ?? null;
}

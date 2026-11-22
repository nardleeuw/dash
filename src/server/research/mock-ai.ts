import type { ResearchOutput } from "@/server/ai/prompts/research";
import type { WebsiteSignals } from "./signals";

/**
 * Mock "AI" research used when OpenAI is in mock mode. It only uses text that
 * was actually crawled, so its observations pass the same validation.
 */
export function mockResearch(pages: { url: string; title: string; text: string; headings: string[]; metaDescription: string }[], signals: WebsiteSignals | null, locale: "nl" | "en"): ResearchOutput {
  const home = pages[0];
  const nl = locale === "nl";
  const observations: ResearchOutput["observations"] = [];
  if (home?.title) observations.push({ text: nl ? `De homepage heeft als titel “${home.title}”.` : `The homepage title is “${home.title}”.`, quote: home.title, source_url: home.url, category: "content" });
  if (home?.metaDescription && home.text.includes(home.metaDescription.slice(0, 40))) observations.push({ text: nl ? "Het bedrijf beschrijft zichzelf op de homepage." : "The company describes itself on the homepage.", quote: home.metaDescription.slice(0, 120), source_url: home.url, category: "services" });
  const firstSentence = home?.text.split(/(?<=[.!?])\s/).find((s) => s.length > 30 && s.length < 200);
  if (firstSentence) observations.push({ text: nl ? "Tekst op de homepage:" : "Text on the homepage:", quote: firstSentence, source_url: home.url, category: "content" });
  return {
    summary: `[Demo-analyse] ${home?.metaDescription || home?.title || (nl ? "Geen website-inhoud beschikbaar." : "No website content available.")}`,
    services: (pages.flatMap((p) => p.headings).filter((h) => h.length < 60).slice(0, 6)),
    target_customers: [],
    observations,
    hypotheses: signals?.outdatedCopyright ? [{ text: nl ? "De website is mogelijk al enige tijd niet bijgewerkt." : "The website may not have been updated for a while.", reasoning: `© ${signals.copyrightYear}`, confidence: 0.4 }] : [],
    opportunities: [],
    injection_attempt_detected: false,
  };
}

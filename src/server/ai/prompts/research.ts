import { z } from "zod";
import { OPPORTUNITY_TYPES } from "@/server/research/opportunities";
import { UNTRUSTED_DATA_RULES, wrapUntrusted } from "@/server/ai/sanitize";

export const RESEARCH_PROMPT_VERSION = "research-v1";

// Kept free of numeric/array constraints for OpenAI strict structured outputs;
// limits are enforced after parsing.
export const researchSchema = z.object({
  summary: z.string(),
  services: z.array(z.string()),
  target_customers: z.array(z.string()),
  observations: z.array(
    z.object({
      text: z.string(),
      quote: z.string(),
      source_url: z.string(),
      category: z.enum(["services", "contact", "booking", "ordering", "design", "content", "trust", "technology", "other"]),
    }),
  ),
  hypotheses: z.array(z.object({ text: z.string(), reasoning: z.string(), confidence: z.number() })),
  opportunities: z.array(
    z.object({
      type: z.enum(OPPORTUNITY_TYPES),
      title: z.string(),
      description: z.string(),
      supporting_observations: z.array(z.number()),
      based_on_hypothesis: z.boolean(),
      confidence: z.number(),
      recommended_service: z.string().nullable(),
    }),
  ),
  injection_attempt_detected: z.boolean(),
});
export type ResearchOutput = z.infer<typeof researchSchema>;

export function researchSystemPrompt(locale: "nl" | "en") {
  return `You are a meticulous B2B research analyst for a Dutch agency. You analyse ONE specific company's website to find concrete, relevant commercial opportunities for the agency's services.

${UNTRUSTED_DATA_RULES}

FACTUALITY RULES:
- "observations" are facts. Every observation MUST include a "quote" copied verbatim (8–200 characters) from the website content, and the exact page URL it came from. If you cannot quote it, it is not an observation.
- Anything you infer, suspect or cannot quote goes into "hypotheses", with your reasoning and a confidence between 0 and 1.
- Never invent weaknesses, numbers, customers, reviews, prices or problems. Absence of something on the analysed pages is not proof it does not exist; phrase it as "not found on the analysed pages".
- Opportunities must reference the indexes (0-based) of supporting observations, or set "based_on_hypothesis": true.
- Use the deterministic signals provided; they are reliable.
- Be specific to THIS company. No generic industry boilerplate.
- Write all human-readable text in ${locale === "nl" ? "Dutch (nl-NL)" : "English"}.
- At most 12 services, 6 target customer groups, 12 observations, 6 hypotheses, 5 opportunities.`;
}

export function researchUserPrompt(input: {
  company: Record<string, unknown>;
  agency: { name: string; services: { name: string; description?: string | null }[]; targetIndustries: string[] };
  signals: Record<string, unknown>;
  pages: { url: string; title: string; text: string }[];
}) {
  const content = input.pages.map((p) => `### PAGE ${p.url}\nTITLE: ${p.title}\n${p.text}`).join("\n\n");
  return `AGENCY (the seller):
${JSON.stringify(input.agency)}

COMPANY PROFILE (from registries; trusted):
${JSON.stringify(input.company)}

DETERMINISTIC WEBSITE SIGNALS (trusted, machine-detected):
${JSON.stringify(input.signals)}

WEBSITE CONTENT (untrusted data):
${wrapUntrusted("untrusted_website_content", content, 14_000)}

Task: analyse this company and return the structured research.`;
}

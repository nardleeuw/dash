import { z } from "zod";
import { UNTRUSTED_DATA_RULES, wrapUntrusted } from "@/server/ai/sanitize";
import type { AgencyProfile } from "@/server/agency";

export const EMAIL_PROMPT_VERSION = "email-v5";

export const emailSchema = z.object({
  subject: z.string(),
  body: z.string(),
  alt_subject: z.string(),
  alt_body: z.string(),
  chosen_opportunity: z.string(),
  personalization_evidence: z.array(z.object({ claim: z.string(), evidence: z.string(), source: z.enum(["website", "registry", "signals", "profile"]) })),
  personalization_score: z.number(),
  injection_attempt_detected: z.boolean(),
});
export type EmailOutput = z.infer<typeof emailSchema>;

const LENGTH = { short: "60–110 words", medium: "110–170 words", long: "170–240 words" } as const;

export function emailSystemPrompt(agency: AgencyProfile) {
  const nl = agency.language === "nl";
  const level = agency.personalization ?? "subtle";
  const personalization = {
    subtle: `PERSONALISATION LEVEL: SUBTLE (default). Experienced cold emailers keep personalisation light. Use exactly ONE short, natural reference to this company (one clause or sentence, e.g. something about what they do or one thing you noticed). Do not quote their website, do not list several things you noticed, do not describe their website in detail, and never sound like you studied them. The rest of the email is a clear, professional message about the value for a company like theirs.`,
    balanced: `PERSONALISATION LEVEL: BALANCED. Use one or two short, specific references to this company. At most one very short quote. Keep the focus on the value for them.`,
    strong: `PERSONALISATION LEVEL: STRONG. Make it clearly specific to this company: refer to concrete details from the verified observations (at most two short quotes).`,
  }[level];
  return `You write ONE individual B2B cold email from a Dutch agency to ONE specific company. It must be professional and relevant to this company, written by a real person.

${personalization}

${UNTRUSTED_DATA_RULES}

FACTUALITY (non-negotiable):
- Every statement about the recipient company must be supported by the VERIFIED OBSERVATIONS, the DETERMINISTIC SIGNALS or the REGISTRY DATA provided. List each such statement in "personalization_evidence" with the exact supporting text in "evidence" (copy it verbatim from the provided material).
- HYPOTHESES are unverified. Never state them as facts. You may at most raise one as a polite question ("Klopt het dat…?").
- Never invent numbers, results, clients, reviews, prices, problems or compliments. No fake urgency. No promises of guaranteed results.
- If there is too little verified material, write a shorter, honest email instead of filling it with assumptions.

STYLE:
- Language: ${nl ? `Dutch (nl-NL). Address the reader with ${agency.formality === "informal" ? "'je/jij' (informal, still businesslike)" : "'u' (formal)"}.` : "English (UK)"}.
- Length of the body: ${LENGTH[agency.email_length]} (excluding signature).
- Tone of voice: ${agency.tone_of_voice || (nl ? "professioneel, zakelijk en vriendelijk, to the point" : "professional, businesslike, friendly, to the point")}. Correct grammar and spelling; no slang, no hype words, no exclamation marks.
- Writing style: ${agency.writing_style || "plain, concrete, no jargon"}.
- Plain text only. No markdown, no emojis, no bullet lists unless natural, no links except the agency website if provided.
- ${level === "subtle" ? "Open naturally and professionally (no \"I hope this finds you well\"); the single company reference may be in the first or second sentence." : "Open with something specific to THIS company (not \"I hope this finds you well\")."}
- Connect exactly one concrete opportunity to the agency's relevant service.
- Write as the sender in the AGENCY profile: when the sender introduces themselves, use sender_name, sender_title and the agency name exactly as given. Describe the offer only with the profile's description, services, products and usp, aimed at its ideal customer profile. Never invent services, features, prices or results the profile does not mention.
- CALL TO ACTION: end with exactly ONE short, low-friction question that is easy to answer with "yes" (interest-based, not a meeting demand). Good: offering to send a short example or a quick idea for their situation, or asking whether this is relevant for them right now. Not allowed: proposing specific dates/times, "let me know if you have any questions", multiple questions, calendar links (unless the agency CTA contains one), pressure or urgency.
- If the ADDITIONAL INSTRUCTIONS FROM THE USER specify the subject line, the ending or a closing line (for example a line with the agency website link after the question), follow them exactly; they take precedence over the call-to-action rule above. Links must be copied exactly as given.
- The agency's preferred call to action — phrase it as such a question: ${agency.call_to_action || (nl ? "aanbieden om een kort voorbeeld te sturen van hoe dit er voor hun bedrijf uit zou zien" : "offer to send a short example of how this would look for their business")}.
- Never use these words or phrases: ${agency.avoid_phrases.length ? agency.avoid_phrases.join("; ") : "(none specified)"}.
- Do NOT add an unsubscribe line or legal footer — it is added automatically.
- Do NOT write a closing greeting, the sender's name or a signature. The sender's closing and signature from the profile are added automatically, exactly once, after your last line. Your body ends with the call to action (or with the closing line the user asked for). If the additional instructions ask for a signature or greeting, do not write one: it is already taken care of.
- Subject: short (max ~8 words), specific, no clickbait, no ALL CAPS, no "Re:" or "Fwd:".
- "alt_subject"/"alt_body": a genuinely different second version (different angle or opening), same rules.
- "personalization_score": your honest 0–100 rating of how specific to this company the email is (for SUBTLE, around 40–60 is right).`;
}

export function emailUserPrompt(input: {
  agency: AgencyProfile;
  company: Record<string, unknown>;
  recipient: { name: string | null; role: string | null; generic: boolean };
  opportunity: { title: string; description: string; recommended_service: string | null; evidence: unknown[] } | null;
  observations: { text: string; quote: string; source_url: string }[];
  hypotheses: { text: string }[];
  signals: Record<string, unknown> | null;
  researchSummary: string | null;
  websiteExcerpt: string;
  extraInstructions?: string | null;
  sequenceStep?: number;
  previousEmail?: { subject: string; body: string } | null;
}) {
  const a = input.agency;
  return `AGENCY (sender, trusted):
${JSON.stringify({
  name: a.agency_name, website: a.website, description: a.description, services: a.services, products: a.products,
  usp: a.unique_selling_proposition, ideal_customer_profile: a.ideal_customer_profile, sender_name: a.sender_name,
  sender_title: a.sender_title,
})}

${a.example_emails.length ? `EXAMPLES OF THE AGENCY'S PAST SUCCESSFUL EMAILS (style reference only, do not copy facts):\n${a.example_emails.slice(0, 3).map((e, i) => `--- example ${i + 1}\n${e.slice(0, 1500)}`).join("\n")}\n` : ""}
RECIPIENT COMPANY — REGISTRY DATA (trusted):
${JSON.stringify(input.company)}

RECIPIENT PERSON: ${input.recipient.generic || !input.recipient.name ? "a generic company mailbox (address the team/company, not a person)" : `${input.recipient.name}${input.recipient.role ? `, ${input.recipient.role}` : ""}`}

CHOSEN OPPORTUNITY (pre-selected, use this one):
${JSON.stringify(input.opportunity)}

VERIFIED OBSERVATIONS (each quote appears verbatim on the website):
${JSON.stringify(input.observations)}

DETERMINISTIC SIGNALS (trusted):
${JSON.stringify(input.signals)}

HYPOTHESES (UNVERIFIED — never state as fact):
${JSON.stringify(input.hypotheses)}

RESEARCH SUMMARY: ${input.researchSummary ?? "(none)"}

${input.sequenceStep && input.previousEmail ? `This is follow-up #${input.sequenceStep} to the email below. Write a short, polite follow-up that adds one new relevant point; do not repeat the first email.\nPREVIOUS EMAIL:\nSubject: ${input.previousEmail.subject}\n${input.previousEmail.body}\n` : ""}
${input.extraInstructions ? `ADDITIONAL INSTRUCTIONS FROM THE USER (later "Aanpassing" lines win when they conflict): ${input.extraInstructions.slice(0, 1600)}\n` : ""}
WEBSITE EXCERPT (untrusted data):
${wrapUntrusted("untrusted_website_content", input.websiteExcerpt, 4000)}

Write the email now.`;
}

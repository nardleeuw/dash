import { describe, expect, it } from "vitest";
import { factCheckEmail, personalizationScore } from "@/server/emails/fact-check";
import { pickRecipient } from "@/server/emails/recipient";
import { mockEmail } from "@/server/emails/mock-writer";
import { chooseOpportunity } from "@/server/emails/generate";
import type { AgencyProfile } from "@/server/agency";

const agency: AgencyProfile = {
  id: "p", client_id: null, agency_name: "Studio Noord", website: "https://studionoord.nl", description: "Wij bouwen AI-receptionisten.",
  services: [{ name: "AI-receptionist", description: "Neemt 24/7 de telefoon op" }], products: null, target_industries: ["dental"],
  ideal_customer_profile: null, unique_selling_proposition: "Binnen 2 weken live.", tone_of_voice: null, writing_style: null, language: "nl",
  email_length: "short", call_to_action: "een kort gesprek van 15 minuten", example_emails: [], avoid_phrases: ["revolutionair"],
  sender_name: "Nard", sender_title: "Oprichter", signature: null,
};

const base = {
  sourceTexts: ["Wij bieden controles, mondhygiëne en implantologie voor het hele gezin.", "Geen boekingswidget of boekingslink op de 2 onderzochte pagina's", '{"name":"Tandartspraktijk Zonnehoek","city":"Utrecht"}'],
  hypotheses: ["De praktijk mist waarschijnlijk veel telefoontjes buiten openingstijden"],
  companyName: "Tandartspraktijk Zonnehoek",
  agencyWebsite: "https://studionoord.nl",
  agencyTexts: ["Binnen 2 weken live."],
  avoidPhrases: ["revolutionair"],
  length: "short" as const,
};

const goodBody = `Beste team van Tandartspraktijk Zonnehoek,

Op uw website las ik dat u controles, mondhygiëne en implantologie biedt voor het hele gezin. Ik zag geen mogelijkheid om online een afspraak te maken.

Bij Studio Noord bouwen we AI-receptionisten die afspraken inplannen, ook buiten openingstijden. Binnen 2 weken live.

Staat u open voor een kort gesprek van 15 minuten?

Met vriendelijke groet,
Nard`;

describe("fact-check", () => {
  it("passes a grounded email", () => {
    const r = factCheckEmail({ ...base, subject: "Online afspraken voor Zonnehoek", body: goodBody, evidence: [
      { claim: "Biedt implantologie", evidence: "controles, mondhygiëne en implantologie", source: "website" },
      { claim: "Geen online boeken", evidence: "Geen boekingswidget of boekingslink", source: "signals" },
    ] });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.passed).toBe(true);
    expect(personalizationScore(80, r)).toBeGreaterThan(60);
  });

  it("flags unsupported claims, invented numbers, hypotheses as facts, foreign links and avoided phrases", () => {
    const body = `${goodBody}\nUw praktijk verliest 30% van de patiënten. De praktijk mist waarschijnlijk veel telefoontjes buiten openingstijden. Zie https://evil.example/x — revolutionair!`;
    const r = factCheckEmail({ ...base, subject: "Re: uw praktijk", body, evidence: [{ claim: "Slechte reviews", evidence: "patiënten klagen over wachttijden", source: "website" }] });
    const codes = r.issues.map((i) => i.code);
    expect(r.passed).toBe(false);
    expect(codes).toEqual(expect.arrayContaining(["unsupported_claim", "unsupported_number", "hypothesis_as_fact", "foreign_link", "avoided_phrase", "deceptive_subject"]));
  });

  it("allows the agency's own link and numbers from the agency profile", () => {
    const r = factCheckEmail({ ...base, subject: "Zonnehoek", body: `${goodBody}\nMeer info: https://studionoord.nl/cases`, evidence: [] });
    expect(r.issues.some((i) => i.code === "foreign_link")).toBe(false);
    expect(r.issues.some((i) => i.code === "unsupported_number")).toBe(false); // "2 weken" is in the agency profile
  });
});

describe("recipient selection", () => {
  it("prefers verified personal addresses and never picks invalid ones", () => {
    const c = (id: string, email_type: string, email_verification: string) => ({ id, email: `${id}@x.nl`, full_name: null, job_title: null, email_type, email_verification });
    expect(pickRecipient([c("info", "generic", "valid"), c("jan", "personal", "valid")])?.id).toBe("jan");
    expect(pickRecipient([c("jan", "personal", "invalid"), c("info", "generic", "unknown")])?.id).toBe("info");
    expect(pickRecipient([c("x", "personal", "invalid")])).toBeNull();
  });
});

describe("mock writer", () => {
  it("only uses research material and passes the fact-check", () => {
    const opp = { title: "Geen online afspraak maken gevonden", description: "…", recommended_service: "AI-receptionist", evidence: [{ text: "Geen boekingswidget of boekingslink op de 2 onderzochte pagina's" }] };
    const out = mockEmail({ agency, companyName: "Tandartspraktijk Zonnehoek", recipientName: null, opportunity: opp, observations: [{ text: "Biedt implantologie", quote: "Wij bieden controles, mondhygiëne en implantologie voor het hele gezin." }] });
    const r = factCheckEmail({ ...base, subject: out.subject, body: out.body, evidence: out.personalization_evidence });
    expect(r.passed).toBe(true);
    expect(out.body).toContain("Beste team van Tandartspraktijk Zonnehoek");
  });
});

describe("opportunity choice", () => {
  it("prefers verified opportunities that map to a service", () => {
    const o = (id: string, is_verified: boolean, recommended_service: string | null, confidence: number) => ({ id, type: "x", title: id, description: "", evidence: [], is_verified, recommended_service, confidence });
    expect(chooseOpportunity([o("a", false, "S", 0.9), o("b", true, null, 0.5), o("c", true, "S", 0.6)], null)?.id).toBe("c");
  });
});

describe("writing preferences in the email prompt", () => {
  it("defaults to subtle personalisation and formal 'u'; respects informal and strong", async () => {
    const { emailSystemPrompt } = await import("@/server/ai/prompts/email");
    const base = { id: "x", client_id: null, agency_name: "A", website: null, description: null, services: [], products: null, target_industries: [], ideal_customer_profile: null, unique_selling_proposition: null, tone_of_voice: null, writing_style: null, language: "nl" as const, email_length: "short" as const, call_to_action: null, example_emails: [], avoid_phrases: [], sender_name: null, sender_title: null, signature: null };
    const def = emailSystemPrompt(base);
    expect(def).toContain("PERSONALISATION LEVEL: SUBTLE");
    expect(def).toContain("'u' (formal)");
    expect(def).toContain("Do not quote their website");
    const custom = emailSystemPrompt({ ...base, personalization: "strong", formality: "informal" });
    expect(custom).toContain("PERSONALISATION LEVEL: STRONG");
    expect(custom).toContain("'je/jij'");
  });
});

describe("call to action rules", () => {
  it("asks for one low-friction yes-question and uses the agency CTA", async () => {
    const { emailSystemPrompt } = await import("@/server/ai/prompts/email");
    const base = { id: "x", client_id: null, agency_name: "A", website: null, description: null, services: [], products: null, target_industries: [], ideal_customer_profile: null, unique_selling_proposition: null, tone_of_voice: null, writing_style: null, language: "nl" as const, email_length: "short" as const, call_to_action: null, example_emails: [], avoid_phrases: [], sender_name: null, sender_title: null, signature: null };
    const p = emailSystemPrompt(base);
    expect(p).toContain("exactly ONE short, low-friction question");
    expect(p).toContain("kort voorbeeld te sturen");
    expect(emailSystemPrompt({ ...base, call_to_action: "gratis lijst met 25 leads" })).toContain("gratis lijst met 25 leads");
  });
});

describe("sign-off", () => {
  it("adds a greeting and name when the model ended with a link line, and cleans '?.'", async () => {
    const { ensureSignOff } = await import("@/server/emails/signoff");
    const body = "Hoi Mark,\n\nSteek je nu wekelijks uren in acquisitie? Interesse?.\n\nBenieuwd geworden? Bekijk alvast hoe het werkt: https://leadwerk-app.vercel.app";
    const out = ensureSignOff(body, { signature: null, sender_name: "Nard", agency_name: "Leadwerk", language: "nl", formality: "informal" });
    expect(out).toContain("Interesse?\n");
    expect(out.endsWith("https://leadwerk-app.vercel.app\n\nGroet,\nNard\nLeadwerk")).toBe(true);
    expect(ensureSignOff(body, { signature: "Met vriendelijke groet,\nNard | Leadwerk", sender_name: "Nard", agency_name: "Leadwerk", language: "nl" }).endsWith("Met vriendelijke groet,\nNard | Leadwerk")).toBe(true);
  });

  it("leaves emails that are already signed alone", async () => {
    const { ensureSignOff } = await import("@/server/emails/signoff");
    const body = "Hoi,\n\nInteresse?\n\nMet vriendelijke groet,\nNard";
    expect(ensureSignOff(body, { signature: null, sender_name: "Nard", agency_name: "Leadwerk", language: "nl" })).toBe(body);
  });
});

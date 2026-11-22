import type { EmailOutput } from "@/server/ai/prompts/email";
import type { AgencyProfile } from "@/server/agency";

/**
 * Deterministic email used when OpenAI runs in mock mode. It only uses
 * verified research material, so it passes the same fact-check.
 */
export function mockEmail(input: {
  agency: AgencyProfile;
  companyName: string;
  recipientName: string | null;
  opportunity: { title: string; description: string; recommended_service: string | null; evidence: { text?: string; quote?: string | null }[] } | null;
  observations: { text: string; quote: string }[];
  sequenceStep?: number;
}): EmailOutput {
  const a = input.agency;
  const nl = a.language === "nl";
  const lc = (x: string) => (/^[A-Z][A-Z0-9-]/.test(x) ? x : x.charAt(0).toLowerCase() + x.slice(1));
  const greet = input.recipientName ? (nl ? `Beste ${input.recipientName.split(" ")[0]},` : `Dear ${input.recipientName.split(" ")[0]},`) : nl ? `Beste team van ${input.companyName},` : `Dear ${input.companyName} team,`;
  const obs = input.observations[0];
  const oppEvidence = input.opportunity?.evidence.find((e) => e.text)?.text ?? null;
  const evidence: EmailOutput["personalization_evidence"] = [];
  const lines: string[] = [greet, ""];

  if (input.sequenceStep && input.sequenceStep > 0) {
    lines.push(nl ? `Ik stuurde u onlangs een bericht over ${input.opportunity?.title.toLowerCase() ?? "uw website"}. Ik wilde even kort navragen of dit interessant is voor ${input.companyName}.` : `I recently wrote to you about ${input.opportunity?.title.toLowerCase() ?? "your website"}. I wanted to briefly follow up in case it's relevant for ${input.companyName}.`);
  } else {
    if (obs) {
      lines.push(nl ? `Ik keek naar de website van ${input.companyName} en las: “${obs.quote}”.` : `I looked at the ${input.companyName} website and read: “${obs.quote}”.`);
      evidence.push({ claim: obs.text, evidence: obs.quote, source: "website" });
    } else {
      lines.push(nl ? `Ik verdiepte me in ${input.companyName}.` : `I looked into ${input.companyName}.`);
    }
    if (input.opportunity && oppEvidence) {
      lines.push(nl ? `Wat me opviel: ${lc(oppEvidence)}.` : `What stood out: ${lc(oppEvidence)}.`);
      evidence.push({ claim: input.opportunity.title, evidence: oppEvidence, source: "signals" });
    }
  }
  const service = input.opportunity?.recommended_service ?? a.services[0]?.name ?? null;
  if (service) lines.push(nl ? `Bij ${a.agency_name} helpen we bedrijven met ${lc(service)}.${a.unique_selling_proposition ? " " + a.unique_selling_proposition : ""}` : `At ${a.agency_name} we help businesses with ${service}.${a.unique_selling_proposition ? " " + a.unique_selling_proposition : ""}`);
  lines.push("", nl ? `Staat u open voor ${a.call_to_action || "een kort vrijblijvend gesprek van 15 minuten"}?` : `Would you be open to ${a.call_to_action || "a short 15-minute call"}?`, "");
  lines.push(a.signature || [nl ? "Met vriendelijke groet," : "Kind regards,", a.sender_name || a.agency_name, a.sender_title].filter(Boolean).join("\n"));
  const body = lines.join("\n");
  const subject = input.opportunity ? `${input.opportunity.title} – ${input.companyName}` : `${input.companyName} × ${a.agency_name}`;
  return {
    subject: subject.slice(0, 90),
    body,
    alt_subject: nl ? `Vraag over ${input.companyName}` : `Question about ${input.companyName}`,
    alt_body: body.replace(greet, input.recipientName ? greet : nl ? "Goedendag," : "Hello,"),
    chosen_opportunity: input.opportunity?.title ?? "",
    personalization_evidence: evidence,
    personalization_score: evidence.length ? 55 : 25,
    injection_attempt_detected: false,
  };
}

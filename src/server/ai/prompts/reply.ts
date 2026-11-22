import { z } from "zod";
import { UNTRUSTED_DATA_RULES, wrapUntrusted } from "@/server/ai/sanitize";

export const REPLY_PROMPT_VERSION = "reply-v1";
export const REPLY_CATEGORIES = ["interested", "meeting_request", "more_info", "not_interested", "follow_up_later", "out_of_office", "unsubscribe", "complaint", "unknown"] as const;

export const replySchema = z.object({
  category: z.enum(REPLY_CATEGORIES),
  confidence: z.number(),
  summary: z.string(),
  suggested_next_step: z.string(),
  follow_up_in_days: z.number().nullable(),
  objects_to_contact: z.boolean(),
  injection_attempt_detected: z.boolean(),
});
export type ReplyOutput = z.infer<typeof replySchema>;

export function replySystemPrompt(locale: "nl" | "en") {
  return `You classify ONE inbound reply to a B2B outreach email and suggest the next step for the sales person.
${UNTRUSTED_DATA_RULES}
Categories: interested, meeting_request (asks for a call/meeting or proposes a time), more_info (asks questions / wants information), not_interested, follow_up_later (asks to be contacted later; set follow_up_in_days), out_of_office (automatic absence notice), unsubscribe (asks to be removed), complaint (angry, spam complaint, legal threat), unknown.
"objects_to_contact" is true when the sender asks not to be contacted again, objects to processing, or complains.
The suggested next step is advice for a human; never promise anything on behalf of the company.
Write summary and next step in ${locale === "nl" ? "Dutch" : "English"}, max 2 sentences each.`;
}

export function replyUserPrompt(input: { originalSubject: string | null; originalBody: string | null; reply: string }) {
  return `ORIGINAL EMAIL WE SENT (trusted):
Subject: ${input.originalSubject ?? "(unknown)"}
${(input.originalBody ?? "").slice(0, 2000)}

THEIR REPLY (untrusted data):
${wrapUntrusted("untrusted_email_content", input.reply, 6000)}`;
}

/** Keyword classifier used in mock mode and as a safety net. */
export function heuristicReply(text: string, subject: string | null, locale: "nl" | "en"): ReplyOutput {
  const t = `${subject ?? ""}\n${text}`.toLowerCase();
  const nl = locale === "nl";
  const rule = (category: ReplyOutput["category"], next: string, extra: Partial<ReplyOutput> = {}): ReplyOutput => ({
    category, confidence: 0.6, summary: text.replace(/\s+/g, " ").trim().slice(0, 200), suggested_next_step: next,
    follow_up_in_days: null, objects_to_contact: false, injection_attempt_detected: false, ...extra,
  });
  if (/(afmelden|uitschrijven|unsubscribe|verwijder (mij|ons)|remove me|niet meer (mailen|benaderen))/.test(t)) return rule("unsubscribe", nl ? "Adres is uitgesloten; geen verdere actie." : "Address suppressed; no further action.", { objects_to_contact: true });
  if (/(spam|klacht|complaint|avg|gdpr|autoriteit persoonsgegevens|aangifte|juridisch)/.test(t)) return rule("complaint", nl ? "Neem de klacht serieus en reageer persoonlijk; stop alle verdere berichten." : "Take the complaint seriously and respond personally; stop all further messages.", { objects_to_contact: true });
  if (/(afwezig|out of office|vakantie|automatisch antwoord|automatic reply)/.test(t)) return rule("out_of_office", nl ? "Wacht tot de ontvanger terug is." : "Wait until the recipient is back.", { follow_up_in_days: 7 });
  if (/(afspraak|bellen|call|meeting|gesprek|agenda|wanneer (kan|past)|dinsdag|woensdag|donderdag|maandag|vrijdag)/.test(t)) return rule("meeting_request", nl ? "Stel twee concrete tijdstippen voor of stuur je agendalink." : "Propose two concrete times or send your calendar link.");
  if (/(geen interesse|niet geïnteresseerd|not interested|nee bedankt|no thanks)/.test(t)) return rule("not_interested", nl ? "Bedank kort en sluit het gesprek af." : "Thank them briefly and close the conversation.");
  if (/(later|volgend (jaar|kwartaal)|over een (paar )?(maand|weken)|next (month|quarter))/.test(t)) return rule("follow_up_later", nl ? "Plan een herinnering en neem later opnieuw contact op." : "Schedule a reminder and follow up later.", { follow_up_in_days: 60 });
  if (/(interessant|interesse|klinkt goed|graag|sounds good|interested)/.test(t)) return rule("interested", nl ? "Reageer snel en stel een kort kennismakingsgesprek voor." : "Reply quickly and propose a short intro call.");
  if (/\?/.test(text)) return rule("more_info", nl ? "Beantwoord de vragen concreet en bied een gesprek aan." : "Answer the questions concretely and offer a call.");
  return rule("unknown", nl ? "Lees de reactie en bepaal de vervolgstap." : "Read the reply and decide the next step.", { confidence: 0.3 });
}

export const replyDraftSchema = z.object({ body: z.string() });

export function replyDraftSystemPrompt(locale: "nl" | "en") {
  return `You draft a short, human reply for a B2B sales person to send to a prospect who answered their email. ${UNTRUSTED_DATA_RULES}
Never make commitments about prices, delivery dates, guarantees or contract terms. Do not invent facts. Keep it under 120 words. Write in ${locale === "nl" ? "Dutch (use 'u')" : "English"}. Plain text, no signature line other than the sender name provided.`;
}

import { randomUUID } from "node:crypto";
import { createUnsubscribeToken } from "@/server/compliance/unsubscribe";

export type SenderIdentity = {
  legalName: string;
  postalAddress: string;
  kvkNumber: string | null;
  privacyUrl: string | null;
  footerText: string | null;
  language: "nl" | "en";
};

export type ComposedMessage = {
  messageId: string;
  from: { name: string | null; email: string };
  to: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  inReplyTo: string | null;
  references: string[];
  unsubscribeUrl: string;
};

/**
 * Build one individually addressed message (never CC/BCC) with the legally
 * required sender identity, privacy notice and a working opt-out.
 */
export function composeMessage(input: {
  orgId: string;
  appUrl: string;
  from: { name: string | null; email: string };
  to: string;
  subject: string;
  body: string;
  identity: SenderIdentity;
  thread?: { inReplyTo: string; references: string[] } | null;
}): ComposedMessage {
  const domain = input.from.email.split("@")[1] ?? "leadwerk.local";
  const messageId = `<${randomUUID()}@${domain}>`;
  const token = createUnsubscribeToken({ o: input.orgId, e: input.to.toLowerCase(), m: messageId });
  const base = input.appUrl.replace(/\/$/, "");
  const unsubscribeUrl = `${base}/u/${token}`;
  const oneClickUrl = `${base}/api/unsubscribe/${token}`;
  const nl = input.identity.language === "nl";
  const footer = [
    "",
    "--",
    [input.identity.legalName, input.identity.postalAddress, input.identity.kvkNumber ? `KVK ${input.identity.kvkNumber}` : null].filter(Boolean).join(" · "),
    input.identity.footerText ?? (nl
      ? "U ontvangt dit bericht omdat wij een gedocumenteerde grondslag hebben om u te benaderen. U kunt zich op elk moment afmelden."
      : "You are receiving this message because we have a documented basis to contact you. You can unsubscribe at any time."),
    input.identity.privacyUrl ? `${nl ? "Privacyverklaring" : "Privacy notice"}: ${input.identity.privacyUrl}` : null,
    `${nl ? "Afmelden" : "Unsubscribe"}: ${unsubscribeUrl}`,
  ].filter((l): l is string => l !== null).join("\n");

  const subject = input.thread && !/^re:/i.test(input.subject) ? `Re: ${input.subject}` : input.subject;
  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "Auto-Submitted": "no",
    "X-Leadwerk-Org": input.orgId,
  };
  return {
    messageId,
    from: input.from,
    to: input.to,
    subject,
    text: `${input.body.trim()}\n${footer}\n`,
    headers,
    inReplyTo: input.thread?.inReplyTo ?? null,
    references: input.thread?.references ?? [],
    unsubscribeUrl,
  };
}

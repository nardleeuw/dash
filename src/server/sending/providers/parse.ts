import { simpleParser, type ParsedMail } from "mailparser";
import type { InboundMessage } from "./types";

const AUTO_SUBJECT = /(afwezig|out of (the )?office|automatisch antwoord|automatic reply|auto[- ]?reply|vakantie|abwesend|autosvar)/i;

/** Parse a raw RFC 822 message into our inbound shape, flagging bounces/auto-replies. */
export async function parseInbound(raw: Buffer | string, receivedAt?: Date): Promise<InboundMessage> {
  const m: ParsedMail = await simpleParser(raw);
  const header = (name: string) => {
    const v = m.headers.get(name);
    return typeof v === "string" ? v : v ? String((v as { value?: string }).value ?? v) : null;
  };
  const from = m.from?.value?.[0];
  const refs = Array.isArray(m.references) ? m.references : m.references ? [m.references] : [];
  const contentType = String(header("content-type") ?? "");
  const fromAddr = (from?.address ?? "").toLowerCase();
  const isBounce = /multipart\/report/i.test(contentType) && /delivery-status/i.test(contentType) || /^(mailer-daemon|postmaster)@/i.test(fromAddr);
  let bouncedRecipient: string | null = (header("x-failed-recipients") ?? "").split(",")[0]?.trim().toLowerCase() || null;
  if (isBounce && !bouncedRecipient) {
    const text = `${m.text ?? ""}\n${m.attachments.map((a) => a.content.toString("utf8")).join("\n")}`;
    bouncedRecipient = text.match(/(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)>?/i)?.[1]?.toLowerCase() ?? null;
  }
  const autoSubmitted = (header("auto-submitted") ?? "no").toLowerCase();
  const isAutoReply = !isBounce && (autoSubmitted !== "no" || !!header("x-autoreply") || !!header("x-autorespond") || /auto_reply/i.test(header("precedence") ?? "") || AUTO_SUBJECT.test(m.subject ?? ""));
  const toValue = Array.isArray(m.to) ? m.to[0] : m.to;
  return {
    messageId: m.messageId ?? `<generated-${Date.now()}-${Math.random().toString(36).slice(2)}@leadwerk>`,
    inReplyTo: m.inReplyTo ?? null,
    references: refs,
    from: fromAddr,
    fromName: from?.name || null,
    to: toValue?.value?.[0]?.address?.toLowerCase() ?? null,
    subject: m.subject ?? null,
    text: (m.text ?? "").slice(0, 50_000),
    receivedAt: receivedAt ?? m.date ?? new Date(),
    isAutoReply,
    isBounce,
    bouncedRecipient,
  };
}

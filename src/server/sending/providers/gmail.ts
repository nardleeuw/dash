import "server-only";
import MailComposer from "nodemailer/lib/mail-composer";
import type { ComposedMessage } from "../compose";
import { SendError, type MailProvider } from "./types";
import { parseInbound } from "./parse";
import { validAccessToken, type OAuthTokens } from "./oauth";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function buildRfc822(msg: ComposedMessage): Promise<Buffer> {
  const mail = new MailComposer({
    from: msg.from.name ? { name: msg.from.name, address: msg.from.email } : msg.from.email,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    messageId: msg.messageId,
    inReplyTo: msg.inReplyTo ?? undefined,
    references: msg.references.length ? msg.references : undefined,
    headers: msg.headers,
  });
  return mail.compile().build();
}

export class GmailProvider implements MailProvider {
  constructor(private tokens: OAuthTokens, private readonly persist: (t: OAuthTokens) => Promise<void>) {}

  private async token() {
    return validAccessToken("google", this.tokens, async (t) => {
      this.tokens = t;
      await this.persist(t);
    });
  }

  async send(msg: ComposedMessage) {
    const raw = (await buildRfc822(msg)).toString("base64url");
    const res = await fetch(`${API}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (res.status === 401 || res.status === 403) throw new SendError(`gmail auth ${res.status}`, "auth");
    if (res.status === 400) throw new SendError(`gmail rejected message: ${await res.text()}`, "permanent");
    if (!res.ok) throw new SendError(`gmail ${res.status}`, "temporary");
    const j = (await res.json()) as { id: string; threadId: string };
    return { providerMessageId: j.id, threadId: j.threadId, messageIdHeader: msg.messageId };
  }

  async fetchInbound(cursor: Record<string, unknown>) {
    const after = Number(cursor.after ?? Math.floor((Date.now() - 14 * 86_400_000) / 1000));
    const token = await this.token();
    const list = await fetch(`${API}/messages?q=${encodeURIComponent(`in:inbox after:${after}`)}&maxResults=100`, { headers: { Authorization: `Bearer ${token}` } });
    if (!list.ok) throw new Error(`gmail list ${list.status}`);
    const ids = ((await list.json()) as { messages?: { id: string }[] }).messages ?? [];
    const messages = [];
    let newest = after;
    for (const { id } of ids) {
      const r = await fetch(`${API}/messages/${id}?format=raw`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const j = (await r.json()) as { raw: string; internalDate: string };
      const received = new Date(Number(j.internalDate));
      messages.push(await parseInbound(Buffer.from(j.raw, "base64url"), received));
      newest = Math.max(newest, Math.floor(received.getTime() / 1000));
    }
    return { messages, cursor: { after: newest } };
  }
}

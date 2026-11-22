import "server-only";
import type { ComposedMessage } from "../compose";
import { SendError, type InboundMessage, type MailProvider } from "./types";
import { validAccessToken, type OAuthTokens } from "./oauth";

const API = "https://graph.microsoft.com/v1.0/me";

/**
 * Microsoft 365 via Graph. Note: Graph only accepts custom "X-" headers, so the
 * List-Unsubscribe header cannot be set; the unsubscribe link in the footer
 * remains (documented limitation).
 */
export class MicrosoftProvider implements MailProvider {
  constructor(private tokens: OAuthTokens, private readonly persist: (t: OAuthTokens) => Promise<void>) {}

  private async token() {
    return validAccessToken("microsoft", this.tokens, async (t) => {
      this.tokens = t;
      await this.persist(t);
    });
  }

  async send(msg: ComposedMessage) {
    const token = await this.token();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const draft = await fetch(`${API}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        subject: msg.subject,
        body: { contentType: "Text", content: msg.text },
        toRecipients: [{ emailAddress: { address: msg.to } }],
        internetMessageHeaders: Object.entries(msg.headers).filter(([k]) => k.startsWith("X-")).map(([name, value]) => ({ name, value })),
      }),
    });
    if (draft.status === 401 || draft.status === 403) throw new SendError(`graph auth ${draft.status}`, "auth");
    if (!draft.ok) throw new SendError(`graph draft ${draft.status}`, draft.status >= 500 ? "temporary" : "permanent");
    const d = (await draft.json()) as { id: string; internetMessageId: string; conversationId: string };
    const sent = await fetch(`${API}/messages/${d.id}/send`, { method: "POST", headers });
    if (!sent.ok) throw new SendError(`graph send ${sent.status}`, sent.status >= 500 ? "temporary" : "permanent");
    // Graph assigns its own Message-ID; use it for reply matching.
    return { providerMessageId: d.id, threadId: d.conversationId, messageIdHeader: d.internetMessageId };
  }

  async fetchInbound(cursor: Record<string, unknown>) {
    const since = String(cursor.since ?? new Date(Date.now() - 14 * 86_400_000).toISOString());
    const token = await this.token();
    const url = `${API}/mailFolders/inbox/messages?$filter=receivedDateTime ge ${since}&$top=100&$select=internetMessageId,internetMessageHeaders,from,toRecipients,subject,body,receivedDateTime`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' } });
    if (!res.ok) throw new Error(`graph list ${res.status}`);
    type G = { internetMessageId: string; internetMessageHeaders?: { name: string; value: string }[]; from?: { emailAddress: { address: string; name: string } }; toRecipients?: { emailAddress: { address: string } }[]; subject: string; body: { content: string }; receivedDateTime: string };
    const items = ((await res.json()) as { value: G[] }).value ?? [];
    let newest = since;
    const messages: InboundMessage[] = items.map((g) => {
      const h = (n: string) => g.internetMessageHeaders?.find((x) => x.name.toLowerCase() === n)?.value ?? null;
      const from = g.from?.emailAddress.address.toLowerCase() ?? "";
      if (g.receivedDateTime > newest) newest = g.receivedDateTime;
      const isBounce = /^(mailer-daemon|postmaster)@/i.test(from);
      return {
        messageId: g.internetMessageId, inReplyTo: h("in-reply-to"), references: (h("references") ?? "").split(/\s+/).filter(Boolean),
        from, fromName: g.from?.emailAddress.name ?? null, to: g.toRecipients?.[0]?.emailAddress.address.toLowerCase() ?? null,
        subject: g.subject, text: g.body.content.slice(0, 50_000), receivedAt: new Date(g.receivedDateTime),
        isAutoReply: !isBounce && ((h("auto-submitted") ?? "no").toLowerCase() !== "no" || /automatic reply|automatisch antwoord|out of office|afwezig/i.test(g.subject)),
        isBounce, bouncedRecipient: null,
      };
    });
    return { messages, cursor: { since: newest } };
  }
}

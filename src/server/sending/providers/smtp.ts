import "server-only";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import type { ComposedMessage } from "../compose";
import { SendError, type MailProvider } from "./types";
import { parseInbound } from "./parse";

export type SmtpConfig = {
  smtp: { host: string; port: number; secure: boolean };
  imap: { host: string; port: number; secure: boolean } | null;
  username: string;
  password: string;
};

export class SmtpProvider implements MailProvider {
  constructor(private readonly cfg: SmtpConfig) {}

  private transport() {
    return nodemailer.createTransport({
      host: this.cfg.smtp.host, port: this.cfg.smtp.port, secure: this.cfg.smtp.secure,
      auth: { user: this.cfg.username, pass: this.cfg.password },
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    });
  }

  async verify() {
    try {
      await this.transport().verify();
    } catch (err) {
      throw new SendError((err as Error).message, "auth");
    }
  }

  async send(msg: ComposedMessage) {
    try {
      const info = await this.transport().sendMail({
        from: msg.from.name ? { name: msg.from.name, address: msg.from.email } : msg.from.email,
        to: msg.to, // exactly one recipient — never cc/bcc
        subject: msg.subject,
        text: msg.text,
        messageId: msg.messageId,
        inReplyTo: msg.inReplyTo ?? undefined,
        references: msg.references.length ? msg.references : undefined,
        headers: msg.headers,
      });
      return { providerMessageId: info.messageId ?? msg.messageId, messageIdHeader: msg.messageId };
    } catch (err) {
      const e = err as { responseCode?: number; code?: string; message: string };
      if (e.code === "EAUTH") throw new SendError(e.message, "auth", e.code);
      if (e.responseCode && e.responseCode >= 500) throw new SendError(e.message, "permanent", String(e.responseCode));
      throw new SendError(e.message, "temporary", e.code ?? String(e.responseCode ?? ""));
    }
  }

  async fetchInbound(cursor: Record<string, unknown>) {
    if (!this.cfg.imap) return { messages: [], cursor };
    const client = new ImapFlow({
      host: this.cfg.imap.host, port: this.cfg.imap.port, secure: this.cfg.imap.secure,
      auth: { user: this.cfg.username, pass: this.cfg.password }, logger: false,
    });
    await client.connect();
    const messages = [];
    let next = { ...cursor };
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox && typeof client.mailbox === "object" ? client.mailbox : null;
      const uidValidity = String(mailbox?.uidValidity ?? "");
      let lastUid = cursor.uidValidity === uidValidity ? Number(cursor.lastUid ?? 0) : 0;
      let range: string;
      if (lastUid > 0) range = `${lastUid + 1}:*`;
      else {
        const since = new Date(Date.now() - 14 * 86_400_000);
        const uids = (await client.search({ since }, { uid: true })) || [];
        range = uids.length ? `${Math.min(...uids)}:*` : "";
      }
      if (range) {
        for await (const m of client.fetch(range, { uid: true, source: true, internalDate: true }, { uid: true })) {
          if (m.uid <= lastUid || !m.source) continue;
          messages.push(await parseInbound(m.source, m.internalDate ? new Date(m.internalDate) : undefined));
          lastUid = Math.max(lastUid, m.uid);
          if (messages.length >= 200) break;
        }
      }
      next = { uidValidity, lastUid };
    } finally {
      lock.release();
      await client.logout().catch(() => undefined);
    }
    return { messages, cursor: next };
  }
}

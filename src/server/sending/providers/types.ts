import type { ComposedMessage } from "../compose";

export type SendResult = { providerMessageId: string | null; threadId?: string | null; messageIdHeader?: string | null };

export class SendError extends Error {
  constructor(message: string, public kind: "permanent" | "temporary" | "auth", public code?: string) {
    super(message);
    this.name = "SendError";
  }
}

export type InboundMessage = {
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  from: string;
  fromName: string | null;
  to: string | null;
  subject: string | null;
  text: string;
  receivedAt: Date;
  isAutoReply: boolean;
  isBounce: boolean;
  bouncedRecipient: string | null;
};

export interface MailProvider {
  send(msg: ComposedMessage): Promise<SendResult>;
  /** Fetch messages received since the cursor; returns a new cursor. */
  fetchInbound?(cursor: Record<string, unknown>): Promise<{ messages: InboundMessage[]; cursor: Record<string, unknown> }>;
  verify?(): Promise<void>;
}

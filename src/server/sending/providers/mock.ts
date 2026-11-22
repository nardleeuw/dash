import { randomUUID } from "node:crypto";
import type { ComposedMessage } from "../compose";
import type { MailProvider } from "./types";

/** Demo/test provider: never sends anything. Recipients with "bounce" in the local part simulate a hard bounce. */
export class MockMailProvider implements MailProvider {
  static sent: ComposedMessage[] = [];

  async send(msg: ComposedMessage) {
    if (/^bounce/i.test(msg.to)) {
      const { SendError } = await import("./types");
      throw new SendError("550 5.1.1 mailbox does not exist (mock)", "permanent", "550");
    }
    MockMailProvider.sent.push(msg);
    if (MockMailProvider.sent.length > 1000) MockMailProvider.sent.shift();
    return { providerMessageId: `mock-${randomUUID()}`, messageIdHeader: msg.messageId };
  }

  async fetchInbound(cursor: Record<string, unknown>) {
    return { messages: [], cursor };
  }

  async verify() {}
}

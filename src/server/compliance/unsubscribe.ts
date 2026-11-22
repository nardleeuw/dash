import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, stateless unsubscribe tokens: base64url(payload).base64url(hmac).
 * The payload identifies the workspace, address and message — no database
 * lookup is needed to validate a click.
 */
export type UnsubscribePayload = { o: string; e: string; m?: string };

function secret() {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (!s) throw new Error("UNSUBSCRIBE_SECRET is not configured");
  return s;
}

export function createUnsubscribeToken(p: UnsubscribePayload): string {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UnsubscribePayload;
    return p.o && p.e ? p : null;
  } catch {
    return null;
  }
}

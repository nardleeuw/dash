import { describe, expect, it } from "vitest";
import { fromZoned, isWithinWindow, nextWindowStart, spreadSchedule, followUpTime, zonedParts } from "@/server/sending/schedule";
import { composeMessage } from "@/server/sending/compose";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "@/server/compliance/unsubscribe";
import { decryptJson, encryptJson, decryptSecret } from "@/server/crypto";
import { parseInbound } from "@/server/sending/providers/parse";

const w = { timezone: "Europe/Amsterdam", sendDays: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };

describe("sending windows (Europe/Amsterdam)", () => {
  it("converts wall-clock time across DST", () => {
    expect(fromZoned(2026, 11, 23, 9, 0, w.timezone).toISOString()).toBe("2026-11-23T08:00:00.000Z"); // CET
    expect(fromZoned(2026, 6, 15, 9, 0, w.timezone).toISOString()).toBe("2026-06-15T07:00:00.000Z"); // CEST
  });

  it("respects days and hours", () => {
    expect(isWithinWindow(new Date("2026-11-23T08:30:00Z"), w)).toBe(true); // Mon 09:30
    expect(isWithinWindow(new Date("2026-11-23T16:30:00Z"), w)).toBe(false); // Mon 17:30
    expect(isWithinWindow(new Date("2026-11-22T10:00:00Z"), w)).toBe(false); // Sunday
  });

  it("finds the next window start", () => {
    expect(nextWindowStart(new Date("2026-11-22T10:00:00Z"), w).toISOString()).toBe("2026-11-23T08:00:00.000Z"); // Sun → Mon 09:00
    expect(nextWindowStart(new Date("2026-11-27T17:00:00Z"), w).toISOString()).toBe("2026-11-30T08:00:00.000Z"); // Fri 18:00 → Mon
    const inside = new Date("2026-11-24T10:00:00Z");
    expect(nextWindowStart(inside, w)).toEqual(inside);
  });

  it("spreads sends with a daily limit and minimum gap", () => {
    const times = spreadSchedule(5, new Date("2026-11-23T07:00:00Z"), w, 2, 120, () => 0);
    const days = times.map((t) => zonedParts(t, w.timezone).d);
    expect(days).toEqual([23, 23, 24, 24, 25]);
    expect(times[1].getTime() - times[0].getTime()).toBeGreaterThanOrEqual(120_000);
    expect(times.every((t) => isWithinWindow(t, w))).toBe(true);
  });

  it("schedules follow-ups inside the window", () => {
    const t = followUpTime(new Date("2026-11-27T15:00:00Z"), 3, w, () => 0); // Fri 16:00 + 3 days = Mon 16:00
    expect(isWithinWindow(t, w)).toBe(true);
    expect(zonedParts(t, w.timezone).wd).toBe(1);
  });
});

describe("message composition", () => {
  const identity = { legalName: "Studio Noord B.V.", privacyUrl: "https://studionoord.nl/privacy", footerText: null, language: "nl" as const };
  const msg = composeMessage({ orgId: "org-1", appUrl: "https://app.example", from: { name: "Nard", email: "nard@studionoord.nl" }, to: "Info@Bakkerij.nl", subject: "Online bestellen", body: "Beste team,\n\nTekst.", identity });

  it("adds sender identity, privacy notice and one-click unsubscribe", () => {
    expect(msg.text).toContain("--\nStudio Noord B.V.\n");
    expect(msg.text).not.toMatch(/KVK|Straat/);
    expect(msg.text).toContain("Privacyverklaring: https://studionoord.nl/privacy");
    expect(msg.text).toContain(msg.unsubscribeUrl);
    expect(msg.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.example\/api\/unsubscribe\/.+>$/);
    expect(msg.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(msg.messageId).toMatch(/^<.+@studionoord\.nl>$/);
    expect(msg.to).toBe("Info@Bakkerij.nl"); // single recipient
  });

  it("threads follow-ups", () => {
    const f = composeMessage({ orgId: "o", appUrl: "https://a", from: { name: null, email: "a@b.nl" }, to: "x@y.nl", subject: "Hallo", body: "b", identity, thread: { inReplyTo: "<1@b.nl>", references: ["<1@b.nl>"] } });
    expect(f.subject).toBe("Re: Hallo");
    expect(f.inReplyTo).toBe("<1@b.nl>");
  });

  it("signs unsubscribe tokens and rejects tampering", () => {
    const token = createUnsubscribeToken({ o: "org-1", e: "info@bakkerij.nl", m: "<x@y>" });
    expect(verifyUnsubscribeToken(token)).toEqual({ o: "org-1", e: "info@bakkerij.nl", m: "<x@y>" });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ o: "org-2", e: "info@bakkerij.nl" })).toString("base64url");
    expect(verifyUnsubscribeToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${body}.AAAA`)).toBeNull();
  });
});

describe("secret encryption", () => {
  it("round-trips and detects tampering", () => {
    const c = encryptJson({ password: "s3cret" });
    expect(c).not.toContain("s3cret");
    expect(decryptJson<{ password: string }>(c).password).toBe("s3cret");
    const parts = c.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});

describe("inbound parsing", () => {
  it("parses replies with threading headers", async () => {
    const raw = "From: Jan <jan@bakkerij.nl>\r\nTo: nard@studionoord.nl\r\nSubject: Re: Online bestellen\r\nMessage-ID: <r1@bakkerij.nl>\r\nIn-Reply-To: <abc@studionoord.nl>\r\nReferences: <abc@studionoord.nl>\r\nDate: Mon, 23 Nov 2026 10:00:00 +0100\r\n\r\nKlinkt interessant, bel me maar.\r\n";
    const m = await parseInbound(raw);
    expect(m).toMatchObject({ from: "jan@bakkerij.nl", inReplyTo: "<abc@studionoord.nl>", isAutoReply: false, isBounce: false });
    expect(m.text).toContain("Klinkt interessant");
  });

  it("detects auto-replies and bounces", async () => {
    const ooo = await parseInbound("From: a@b.nl\r\nSubject: Afwezig: Online bestellen\r\nAuto-Submitted: auto-replied\r\nMessage-ID: <o@b>\r\n\r\nIk ben afwezig.");
    expect(ooo.isAutoReply).toBe(true);
    const dsn = await parseInbound("From: MAILER-DAEMON@mx.example\r\nSubject: Undelivered\r\nMessage-ID: <d@mx>\r\nX-Failed-Recipients: gone@bakkerij.nl\r\nContent-Type: text/plain\r\n\r\n550 5.1.1 User unknown");
    expect(dsn).toMatchObject({ isBounce: true, bouncedRecipient: "gone@bakkerij.nl" });
  });
});

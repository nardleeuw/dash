import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

/**
 * Email address extraction and filtering. Pure — unit tested.
 *
 * Finds addresses the way people publish them on Dutch SMB websites: mailto
 * links, plain text, Cloudflare "email protection", "info [at] domein [dot] nl"
 * notations and JSON-LD. Placeholder/technical addresses are dropped.
 */

const EMAIL_RE = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9_%+-])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/;
const TEXT_EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const AT = String.raw`(?:\s*(?:\[\s*(?:at|@)\s*\]|\(\s*(?:at|@)\s*\)|\{\s*(?:at|@)\s*\})\s*|\s+@\s+)`;
const DOT = String.raw`(?:\s*(?:\[\s*(?:dot|punt)\s*\]|\(\s*(?:dot|punt)\s*\)|\{\s*(?:dot|punt)\s*\})\s*|\.)`;
const OBFUSCATED_RE = new RegExp(String.raw`([a-z0-9._%+-]+)${AT}([a-z0-9-]+(?:${DOT}[a-z0-9-]+)+)`, "gi");

/** Placeholder, example and technical domains that are never a business address. */
const JUNK_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "example.nl", "voorbeeld.nl", "domain.com", "domein.nl", "uwdomein.nl", "jouwdomein.nl",
  "yourdomain.com", "mydomain.com", "email.com", "test.com", "test.nl", "mysite.com", "website.nl", "sentry.io", "wixpress.com",
  "sentry.wixpress.com", "sentry-next.wixpress.com", "localhost",
]);
const JUNK_LOCAL = /^(naam|name|voornaam|jouw(naam)?|uw(naam)?|your(name)?|user|gebruiker|email|e-mail|mail|xxx|test|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|abuse)$/;
const FILE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|css|js|json|xml|pdf|mp4|webm|woff2?|ttf|eot)$/i;

/** Consumer mailbox providers. Accepted only when a business publishes such an address itself. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.nl", "outlook.com", "outlook.nl", "live.com", "live.nl", "msn.com",
  "icloud.com", "me.com", "mac.com", "yahoo.com", "yahoo.nl", "ymail.com", "kpnmail.nl", "kpnplanet.nl", "planet.nl", "hetnet.nl",
  "home.nl", "ziggo.nl", "upcmail.nl", "chello.nl", "casema.nl", "xs4all.nl", "online.nl", "telfort.nl", "tele2.nl", "zonnet.nl",
  "quicknet.nl", "caiway.nl", "zeelandnet.nl", "solcon.nl", "protonmail.com", "proton.me", "gmx.com", "gmx.net", "aol.com",
]);

export function normalizeEmail(raw: string): string | null {
  let v = raw.trim().toLowerCase();
  try {
    v = decodeURIComponent(v);
  } catch {
    /* keep as is */
  }
  v = v.replace(/^mailto:/, "").split("?")[0].replace(/^[<("'\s]+|[>)"'.,;:\s]+$/g, "");
  if (v.length > 254 || !EMAIL_RE.test(v)) return null;
  if (isJunkEmail(v)) return null;
  return v;
}

export function isJunkEmail(email: string): boolean {
  const [local, domain] = email.split("@");
  if (!local || !domain) return true;
  if (FILE_EXT.test(email)) return true; // e.g. logo@2x.png
  if (JUNK_DOMAINS.has(domain) || [...JUNK_DOMAINS].some((d) => domain.endsWith("." + d))) return true;
  if (JUNK_LOCAL.test(local)) return true;
  return false;
}

/** Cloudflare "email address obfuscation": hex string, first byte is the XOR key. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/** Addresses in visible text, including "[at]"/"(at)"/"[dot]" notations. */
export function emailsFromText(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TEXT_EMAIL_RE)) {
    const e = normalizeEmail(m[0]);
    if (e) out.add(e);
  }
  for (const m of text.matchAll(OBFUSCATED_RE)) {
    const domain = m[2].replace(new RegExp(DOT, "gi"), ".");
    const e = normalizeEmail(`${m[1]}@${domain}`);
    if (e) out.add(e);
  }
  return [...out];
}

/** Addresses in markup that is not visible text: mailto, Cloudflare protection, JSON-LD. Call before removing scripts. */
export function emailsFromMarkup($: CheerioAPI): string[] {
  const out = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const e = raw ? normalizeEmail(raw) : null;
    if (e) out.add(e);
  };
  $('a[href^="mailto:" i]').each((_, el) => add($(el).attr("href")));
  $("[data-cfemail]").each((_, el) => add(decodeCfEmail($(el).attr("data-cfemail") ?? "")));
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => add(decodeCfEmail(($(el).attr("href") ?? "").split("#")[1] ?? "")));
  $('script[type="application/ld+json"]').each((_, el) => {
    for (const m of ($(el).html() ?? "").matchAll(TEXT_EMAIL_RE)) add(m[0]);
  });
  return [...out];
}

const BLOCKS = "p,div,li,ul,ol,dt,dd,h1,h2,h3,h4,h5,h6,td,th,tr,table,section,article,header,footer,nav,aside,main,address,blockquote,figcaption,form,label,button,option";

/**
 * Visible text of a document with block elements separated by spaces, so
 * "<h1>Café</h1><p>info@cafe.nl</p>" does not become "Caféinfo@cafe.nl".
 * Removes scripts/styles from the given document.
 */
export function visibleText($: CheerioAPI): string {
  $("script,style,noscript,svg,template").remove();
  $("br").replaceWith(" ");
  $(BLOCKS).each((_, el) => {
    $(el).prepend(" ").append(" ");
  });
  return $("body").text().replace(/\s+/g, " ").trim();
}

/** All addresses on a page (used to verify addresses suggested by AI web search). */
export function extractEmailsFromHtml(html: string): string[] {
  const $ = cheerio.load(html);
  const fromMarkup = emailsFromMarkup($);
  return [...new Set([...fromMarkup, ...emailsFromText(visibleText($))])];
}

export function emailDomain(email: string): string {
  return email.split("@")[1] ?? "";
}

/**
 * Whether an address can belong to the business: its own (sub)domain, or a
 * consumer mailbox the business publishes itself. Addresses of other
 * companies (e.g. the web designer in the footer) are rejected.
 */
export function acceptableForBusiness(email: string, businessDomain: string | null, opts: { publishedByBusiness: boolean }): boolean {
  const d = emailDomain(email);
  if (businessDomain && (d === businessDomain || d.endsWith("." + businessDomain))) return true;
  return opts.publishedByBusiness && FREE_MAIL_DOMAINS.has(d);
}

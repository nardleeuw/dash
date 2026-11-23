import * as cheerio from "cheerio";
import { emailsFromMarkup, emailsFromText, visibleText } from "@/server/contacts/emails";

/** Structured extraction of a single HTML page. Pure — unit tested. */
export type PageExtract = {
  url: string;
  title: string;
  metaDescription: string;
  lang: string | null;
  generator: string | null;
  viewport: string | null;
  headings: string[];
  text: string;
  links: { href: string; text: string }[];
  forms: { action: string; fields: string[]; hasEmail: boolean; hasTextarea: boolean; text: string }[];
  scripts: string[];
  iframes: string[];
  emails: string[];
  phones: string[];
  socials: string[];
  jsonLdTypes: string[];
  copyrightYears: number[];
  imagesWithoutAlt: number;
  images: number;
};

const SOCIAL = /(facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com|pinterest\.)/i;

export function extractPage(html: string, pageUrl: string): PageExtract {
  const $ = cheerio.load(html);
  const abs = (href: string) => {
    try {
      return new URL(href, pageUrl).toString();
    } catch {
      return "";
    }
  };
  const scripts = $("script[src]").map((_, el) => abs($(el).attr("src") ?? "")).get().filter(Boolean);
  const inlineScripts = $("script:not([src])").map((_, el) => $(el).html() ?? "").get().join("\n").slice(0, 200_000);
  const iframes = $("iframe[src]").map((_, el) => abs($(el).attr("src") ?? "")).get().filter(Boolean);
  const jsonLdTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() ?? "null");
      const items = Array.isArray(data) ? data : data?.["@graph"] ?? [data];
      for (const it of items) if (it?.["@type"]) jsonLdTypes.push(...[].concat(it["@type"]));
    } catch {
      /* ignore invalid JSON-LD */
    }
  });
  const links = $("a[href]")
    .map((_, el) => ({ href: abs($(el).attr("href") ?? ""), text: $(el).text().replace(/\s+/g, " ").trim().slice(0, 120) }))
    .get()
    .filter((l) => l.href);
  const forms = $("form")
    .map((_, el) => {
      const f = $(el);
      const fields = f.find("input,select,textarea").map((__, i) => ($(i).attr("type") ?? i.tagName ?? "").toLowerCase() + ":" + ($(i).attr("name") ?? "")).get();
      return {
        action: abs(f.attr("action") ?? pageUrl),
        fields,
        hasEmail: f.find('input[type="email"], input[name*="mail" i]').length > 0,
        hasTextarea: f.find("textarea").length > 0,
        text: f.text().replace(/\s+/g, " ").trim().slice(0, 300),
      };
    })
    .get();

  const markupEmails = emailsFromMarkup($);
  const text = visibleText($);
  const emails = new Set<string>([...markupEmails, ...emailsFromText(text)]);
  const phones = new Set<string>();
  $('a[href^="tel:"]').each((_, el) => {
    phones.add(($(el).attr("href") ?? "").replace(/^tel:/i, "").trim());
  });
  const years = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1])).filter((y) => y > 1995 && y < 2100);

  return {
    url: pageUrl,
    title: $("title").first().text().trim().slice(0, 200),
    metaDescription: ($('meta[name="description"]').attr("content") ?? "").trim().slice(0, 400),
    lang: $("html").attr("lang") ?? null,
    generator: $('meta[name="generator"]').attr("content") ?? null,
    viewport: $('meta[name="viewport"]').attr("content") ?? null,
    headings: $("h1,h2").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).slice(0, 30),
    text,
    links,
    forms,
    scripts: [...scripts, ...(inlineScripts ? ["inline:" + inlineScripts.slice(0, 20_000)] : [])],
    iframes,
    emails: [...emails].slice(0, 20),
    phones: [...phones].slice(0, 10),
    socials: [...new Set(links.map((l) => l.href).filter((h) => SOCIAL.test(h)))].slice(0, 10),
    jsonLdTypes: [...new Set(jsonLdTypes)],
    copyrightYears: years,
    images: $("img").length,
    imagesWithoutAlt: $("img:not([alt]), img[alt='']").length,
  };
}

/** Pick the most informative internal pages to crawl after the homepage. */
const PRIORITY: [RegExp, number][] = [
  [/(contact|bereikbaarheid)/i, 10],
  [/(afspraak|boeken|booking|reserver|plannen|agenda)/i, 9],
  [/(diensten|services|behandeling|aanbod|wat-we-doen|werkzaamheden)/i, 8],
  [/(over-ons|over|about|wie-zijn-wij|team)/i, 7],
  [/(offerte|prijzen|tarieven|pricing|kosten)/i, 6],
];

/** Pages where businesses publish addresses and the people behind the company. */
export const CONTACT_PRIORITY: [RegExp, number][] = [
  [/(contact|bereikbaarheid)/i, 10],
  [/(team|medewerkers|over-ons|over|about|wie-zijn-wij|organisatie|praktijk)/i, 9],
  [/(colofon|impressum)/i, 8],
  [/(privacy|disclaimer|algemene-voorwaarden|voorwaarden)/i, 6],
];

export function pickInternalPages(extract: PageExtract, origin: string, max = 4, priorities: [RegExp, number][] = PRIORITY): string[] {
  const candidates = new Map<string, number>();
  for (const l of extract.links) {
    let u: URL;
    try {
      u = new URL(l.href);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|webp|zip|docx?|xlsx?)$/i.test(u.pathname)) continue;
    u.hash = "";
    const key = u.toString().replace(/\/$/, "");
    if (key === origin || key === extract.url.replace(/\/$/, "")) continue;
    const hay = `${u.pathname} ${l.text}`;
    const score = priorities.find(([re]) => re.test(hay))?.[1] ?? 0;
    if (score > (candidates.get(key) ?? -1)) candidates.set(key, score);
  }
  return [...candidates.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

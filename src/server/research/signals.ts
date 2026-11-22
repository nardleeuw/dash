import type { PageExtract } from "./extract";

/**
 * Deterministic, explainable website signals. Each detected signal carries the
 * evidence (URL + matched snippet) so it can be shown to the user and used as
 * a *verified observation* — unlike AI hypotheses.
 */
export type Evidence = { url: string; detail: string };

export type WebsiteSignals = {
  reachable: boolean;
  https: boolean;
  mobileViewport: boolean;
  hasContactForm: boolean;
  hasQuoteForm: boolean;
  hasOnlineBooking: boolean;
  bookingProviders: string[];
  hasOnlineOrdering: boolean;
  orderingProviders: string[];
  hasLiveChat: boolean;
  chatProviders: string[];
  hasWhatsApp: boolean;
  hasNewsletter: boolean;
  hasAnalytics: boolean;
  hasPrivacyPolicy: boolean;
  cms: string | null;
  copyrightYear: number | null;
  outdatedCopyright: boolean;
  emails: string[];
  phones: string[];
  socials: string[];
  structuredData: string[];
  pageCount: number;
  avgResponseMs: number | null;
  totalBytes: number;
  imagesWithoutAltRatio: number | null;
  language: string | null;
  evidence: Record<string, Evidence[]>;
};

const BOOKING = [
  ["calendly", /calendly\.com/i], ["salonized", /salonized\./i], ["treatwell", /treatwell\./i], ["zenchef", /zenchef\./i],
  ["resengo", /resengo\./i], ["formitable", /formitable\./i], ["simplybook", /simplybook\./i], ["acuity", /acuityscheduling\.com/i],
  ["setmore", /setmore\.com/i], ["booksy", /booksy\.com/i], ["fresha", /fresha\.com/i], ["timify", /timify\./i],
  ["onlineafspraken", /onlineafspraken\.nl/i], ["cal.com", /cal\.com\//i], ["youcanbookme", /youcanbook\.me/i], ["planyo", /planyo\./i],
  ["bookingkit", /bookingkit\./i], ["opentable", /opentable\./i], ["thefork", /thefork\./i], ["zoho-bookings", /bookings\.zoho/i],
  ["hubspot-meetings", /meetings\.hubspot\.com/i], ["praktijkinfo", /praktijkinfo\.nl/i], ["mijnafspraak", /mijnafspraak|afspraakmaken\./i],
] as const;
const ORDERING = [
  ["thuisbezorgd", /thuisbezorgd\.nl/i], ["ubereats", /ubereats\.com/i], ["deliveroo", /deliveroo\./i], ["shopify", /cdn\.shopify\.com|myshopify\.com/i],
  ["woocommerce", /woocommerce|wc-ajax/i], ["lightspeed", /lightspeed(hq)?\.(com|app)|seoshop/i], ["mollie-checkout", /mollie\.com/i],
] as const;
const CHAT = [
  ["intercom", /intercom(cdn)?\.io|widget\.intercom/i], ["drift", /js\.driftt\.com|drift\.com/i], ["tawk", /tawk\.to/i], ["crisp", /crisp\.chat/i],
  ["livechat", /livechatinc\.com/i], ["zendesk", /zdassets\.com|zopim/i], ["hubspot-chat", /js\.hs-scripts\.com|usemessages\.com/i],
  ["tidio", /tidio\.co/i], ["smartsupp", /smartsupp\.com/i], ["trengo", /trengo\./i], ["watermelon", /watermelon\.ai/i],
] as const;
const ANALYTICS = /googletagmanager\.com|google-analytics\.com|gtag\(|plausible\.io|matomo|connect\.facebook\.net|hotjar/i;
const CMS: [string, RegExp][] = [
  ["WordPress", /wp-content|wp-includes|wordpress/i], ["Wix", /wix\.com|wixstatic/i], ["Squarespace", /squarespace/i], ["Webflow", /webflow/i],
  ["Shopify", /cdn\.shopify\.com/i], ["Joomla", /joomla/i], ["Jimdo", /jimdo/i], ["Drupal", /drupal/i], ["Lightspeed", /seoshop|lightspeed/i],
];

export function detectSignals(pages: (PageExtract & { https: boolean; ms: number; bytes: number })[], now = new Date()): WebsiteSignals {
  const evidence: Record<string, Evidence[]> = {};
  const add = (key: string, url: string, detail: string) => ((evidence[key] ??= []).length < 3 ? evidence[key].push({ url, detail: detail.slice(0, 160) }) : null);
  const found = (list: readonly (readonly [string, RegExp])[], key: string) => {
    const names = new Set<string>();
    for (const p of pages) {
      const hay = [...p.scripts, ...p.iframes, ...p.links.map((l) => l.href)];
      for (const [name, re] of list) {
        const hit = hay.find((h) => re.test(h));
        if (hit) {
          names.add(name);
          add(key, p.url, hit.startsWith("inline:") ? `${name} script` : hit);
        }
      }
    }
    return [...names];
  };

  const bookingProviders = found(BOOKING, "hasOnlineBooking");
  const orderingProviders = found(ORDERING, "hasOnlineOrdering");
  const chatProviders = found(CHAT, "hasLiveChat");

  // Text-based booking hints only count when they link somewhere actionable.
  let bookingLink = false;
  for (const p of pages) {
    const l = p.links.find((x) => /(online )?(afspraak maken|afspraak plannen|boek (nu|direct|online)|reserveer( nu| online)?|book (now|online))/i.test(x.text));
    if (l) {
      bookingLink = true;
      add("hasOnlineBooking", p.url, `link: “${l.text}” → ${l.href}`);
    }
  }

  let hasContactForm = false;
  let hasQuoteForm = false;
  for (const p of pages) {
    for (const f of p.forms) {
      if (f.hasEmail && f.hasTextarea) {
        hasContactForm = true;
        add("hasContactForm", p.url, `form → ${f.action}`);
      }
      if (/offerte|quote|aanvraag/i.test(f.text + " " + f.fields.join(" ") + " " + p.url)) {
        hasQuoteForm = true;
        add("hasQuoteForm", p.url, `form “${f.text.slice(0, 60)}”`);
      }
    }
  }

  const hasWhatsApp = pages.some((p) => p.links.some((l) => /wa\.me|api\.whatsapp\.com/i.test(l.href) && add("hasWhatsApp", p.url, l.href) !== undefined));
  const hasNewsletter = pages.some((p) => p.forms.some((f) => /nieuwsbrief|newsletter|mailchimp|subscribe/i.test(f.text + f.action)));
  const hasAnalytics = pages.some((p) => p.scripts.some((s) => ANALYTICS.test(s)));
  const hasPrivacyPolicy = pages.some((p) => p.links.some((l) => /privacy/i.test(l.href + l.text)));
  const allHay = pages.flatMap((p) => [...p.scripts, p.generator ?? ""]).join(" ");
  const cms = pages.find((p) => p.generator)?.generator?.split(" ")[0] ?? CMS.find(([, re]) => re.test(allHay))?.[0] ?? null;

  const years = pages.flatMap((p) => p.copyrightYears);
  const copyrightYear = years.length ? Math.max(...years) : null;
  const outdatedCopyright = copyrightYear !== null && copyrightYear < now.getFullYear() - 2;
  if (copyrightYear) add("copyrightYear", pages[0].url, `© ${copyrightYear}`);

  const home = pages[0];
  const mobileViewport = !!home?.viewport && /width\s*=\s*device-width/i.test(home.viewport);
  if (home?.viewport) add("mobileViewport", home.url, `viewport: ${home.viewport}`);
  const images = pages.reduce((a, p) => a + p.images, 0);

  return {
    reachable: pages.length > 0,
    https: pages.length > 0 && pages.every((p) => p.https),
    mobileViewport,
    hasContactForm,
    hasQuoteForm,
    hasOnlineBooking: bookingProviders.length > 0 || bookingLink,
    bookingProviders,
    hasOnlineOrdering: orderingProviders.length > 0,
    orderingProviders,
    hasLiveChat: chatProviders.length > 0,
    chatProviders,
    hasWhatsApp,
    hasNewsletter,
    hasAnalytics,
    hasPrivacyPolicy,
    cms,
    copyrightYear,
    outdatedCopyright,
    emails: [...new Set(pages.flatMap((p) => p.emails))].slice(0, 10),
    phones: [...new Set(pages.flatMap((p) => p.phones))].slice(0, 5),
    socials: [...new Set(pages.flatMap((p) => p.socials))].slice(0, 8),
    structuredData: [...new Set(pages.flatMap((p) => p.jsonLdTypes))].slice(0, 10),
    pageCount: pages.length,
    avgResponseMs: pages.length ? Math.round(pages.reduce((a, p) => a + p.ms, 0) / pages.length) : null,
    totalBytes: pages.reduce((a, p) => a + p.bytes, 0),
    imagesWithoutAltRatio: images ? Math.round((pages.reduce((a, p) => a + p.imagesWithoutAlt, 0) / images) * 100) / 100 : null,
    language: home?.lang ?? null,
    evidence,
  };
}

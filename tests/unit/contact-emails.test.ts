import { describe, expect, it } from "vitest";
import { acceptableForBusiness, decodeCfEmail, emailsFromText, extractEmailsFromHtml, isJunkEmail, normalizeEmail } from "@/server/contacts/emails";
import { CONTACT_PRIORITY, extractPage, pickInternalPages } from "@/server/research/extract";

const cfEncode = (email: string, key = 0x5a) =>
  key.toString(16).padStart(2, "0") + [...email].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");

describe("email extraction", () => {
  it("decodes Cloudflare-protected addresses (span and link)", () => {
    expect(decodeCfEmail(cfEncode("info@bakkerijdevries.nl"))).toBe("info@bakkerijdevries.nl");
    const html = `<body><p>Mail: <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${cfEncode("info@bakkerijdevries.nl")}">[email&#160;protected]</a></p>
      <a href="/cdn-cgi/l/email-protection#${cfEncode("jan@bakkerijdevries.nl")}">mail Jan</a></body>`;
    expect(extractEmailsFromHtml(html).sort()).toEqual(["info@bakkerijdevries.nl", "jan@bakkerijdevries.nl"]);
  });

  it("reads [at]/(at)/[dot] notations and spaced @", () => {
    expect(emailsFromText("Mail ons: info [at] kapsalonlisa [dot] nl of planning(at)kapsalonlisa.nl").sort()).toEqual(["info@kapsalonlisa.nl", "planning@kapsalonlisa.nl"]);
    expect(emailsFromText("e-mail: praktijk @ fysiozuid.nl")).toEqual(["praktijk@fysiozuid.nl"]);
    expect(emailsFromText("Kom eens langs at the office. Prijs: 10 euro.")).toEqual([]);
  });

  it("reads mailto (encoded, with subject) and JSON-LD", () => {
    const html = `<head><script type="application/ld+json">{"@type":"Dentist","email":"mailto:balie@tandartsnoord.nl"}</script></head>
      <body><a href="mailto:Afspraken%40TandartsNoord.nl?subject=Afspraak">Mail</a></body>`;
    expect(extractEmailsFromHtml(html).sort()).toEqual(["afspraken@tandartsnoord.nl", "balie@tandartsnoord.nl"]);
  });

  it("drops placeholders, technical and file-like addresses", () => {
    for (const e of ["naam@voorbeeld.nl", "your@email.com", "abc123@sentry.wixpress.com", "logo@2x.png", "noreply@shop.nl", "jouw@domein.nl"]) {
      expect(isJunkEmail(e) || normalizeEmail(e) === null).toBe(true);
    }
    expect(normalizeEmail(" Info@Bakkerij.NL. ")).toBe("info@bakkerij.nl");
  });

  it("feeds the page extractor (Cloudflare address ends up in emails)", () => {
    const page = extractPage(`<html><body><span data-cfemail="${cfEncode("hallo@studio.nl")}"></span></body></html>`, "https://studio.nl/");
    expect(page.emails).toContain("hallo@studio.nl");
  });
});

describe("business address rule", () => {
  it("accepts own (sub)domain and self-published consumer mailboxes only", () => {
    expect(acceptableForBusiness("info@bakkerij.nl", "bakkerij.nl", { publishedByBusiness: false })).toBe(true);
    expect(acceptableForBusiness("info@mail.bakkerij.nl", "bakkerij.nl", { publishedByBusiness: false })).toBe(true);
    expect(acceptableForBusiness("bakkerij.jansen@gmail.com", "bakkerij.nl", { publishedByBusiness: true })).toBe(true);
    expect(acceptableForBusiness("bakkerij.jansen@gmail.com", "bakkerij.nl", { publishedByBusiness: false })).toBe(false);
    expect(acceptableForBusiness("hello@webdesignbureau.nl", "bakkerij.nl", { publishedByBusiness: true })).toBe(false);
  });
});

describe("contact page selection", () => {
  it("prefers contact, team and colofon pages", () => {
    const page = extractPage(`<body>
      <a href="/diensten">Diensten</a><a href="/blog/nieuws">Nieuws</a><a href="/contact">Contact</a>
      <a href="/ons-team">Ons team</a><a href="/colofon">Colofon</a></body>`, "https://bedrijf.nl/");
    expect(pickInternalPages(page, "https://bedrijf.nl", 3, CONTACT_PRIORITY)).toEqual([
      "https://bedrijf.nl/contact", "https://bedrijf.nl/ons-team", "https://bedrijf.nl/colofon",
    ]);
  });
});

describe("web search findings", () => {
  it("cleans titles from names and ranks decision makers first", async () => {
    const { cleanPersonName, rankPeople } = await import("@/server/contacts/web-search");
    expect(cleanPersonName("Drs. Jan de Vries MSc")).toBe("Jan de Vries");
    expect(cleanPersonName("Tandarts Ayşe Yılmaz")).toBe("Ayşe Yılmaz");
    expect(cleanPersonName("Balie")).toBeNull();
    const ranked = rankPeople([{ name: "Kim B", role: "Assistent" }, { name: "Eva A", role: "Praktijkhouder" }, { name: "Kim B", role: "Assistent" }]);
    expect(ranked.map((p) => p.name)).toEqual(["Eva A", "Kim B"]);
  });

  it("accepts only addresses and names that literally appear on the cited page", async () => {
    const { verifyFindings } = await import("@/server/contacts/web-search");
    const pages = new Map<string, string | null>([
      ["https://www.cafedebrug.nl/contact", `<body><p>Mail: <a href="mailto:hallo@cafedebrug.nl">hallo@cafedebrug.nl</a></p><p>Eigenaar Mark Smits</p></body>`],
      ["https://gids.example/cafe-de-brug", `<body><h1>Café de Brug</h1><p>cafedebrug@gmail.com</p></body>`],
      ["https://gids.example/ander-cafe", `<body><h1>Ander Café</h1><p>andercafe@gmail.com</p></body>`],
    ]);
    const r = verifyFindings(
      {
        emails: [
          { email: "hallo@cafedebrug.nl", source_url: "https://www.cafedebrug.nl/contact", quote: "" },
          { email: "info@cafedebrug.nl", source_url: "https://www.cafedebrug.nl/contact", quote: "" }, // not on the page
          { email: "cafedebrug@gmail.com", source_url: "https://gids.example/cafe-de-brug", quote: "" }, // directory page about this business
          { email: "andercafe@gmail.com", source_url: "https://gids.example/ander-cafe", quote: "" }, // page about another business
        ],
        people: [{ name: "Mark Smits", role: "Eigenaar", source_url: "https://www.cafedebrug.nl/contact" }, { name: "Sanne Verzonnen", role: "Manager", source_url: "https://www.cafedebrug.nl/contact" }],
      },
      { name: "Café de Brug", domain: "cafedebrug.nl" },
      pages,
    );
    expect(r.emails.map((e) => e.email)).toEqual(["hallo@cafedebrug.nl", "cafedebrug@gmail.com"]);
    expect(r.people.map((p) => p.name)).toEqual(["Mark Smits"]);
    expect(r.rejected).toBe(3);
  });
});

describe("glued text", () => {
  it("drops a phone number glued in front of an address", () => {
    const html = `<body><p>Bel <span>030 6000090</span><a href="mailto:info@dental.nl">info@dental.nl</a></p><p>Tel 0306000090info@dental.nl</p></body>`;
    expect(extractEmailsFromHtml(html)).toEqual(["info@dental.nl"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  classifyEmail, extractDomain, formatPostalCode, isPlatformDomain, nameSimilarity, normalizeName,
  normalizePhone, normalizePostalCode, normalizeUrl,
} from "@/server/discovery/normalize";

describe("normalisation", () => {
  it("normalises Dutch postcodes", () => {
    expect(normalizePostalCode("3511 bt")).toBe("3511BT");
    expect(normalizePostalCode("0511BT")).toBeNull();
    expect(formatPostalCode("3511BT")).toBe("3511 BT");
  });

  it("normalises phone numbers to E.164", () => {
    expect(normalizePhone("030 - 123 45 67")).toBe("+31301234567");
    expect(normalizePhone("0031 30 1234567")).toBe("+31301234567");
    expect(normalizePhone("+31 6 12345678")).toBe("+31612345678");
  });

  it("normalises URLs and extracts domains", () => {
    expect(normalizeUrl("www.bakkerij.nl/?utm_source=x")).toBe("https://www.bakkerij.nl");
    expect(extractDomain("https://WWW.Bakkerij.nl/contact")).toBe("bakkerij.nl");
    expect(normalizeUrl("not a url")).toBeNull();
    expect(isPlatformDomain("nl-nl.facebook.com")).toBe(true);
    expect(isPlatformDomain("bakkerij.nl")).toBe(false);
  });

  it("strips legal forms from names", () => {
    expect(normalizeName("Bakkerij De Vries B.V.")).toBe("bakkerij de vries");
    expect(normalizeName("Jansen & Zn. V.O.F.")).toBe("jansen en zn");
    expect(nameSimilarity("Tandartspraktijk Utrecht BV", "Tandartspraktijk Utrecht")).toBe(1);
    expect(nameSimilarity("Bakkerij Jansen", "Garage Pietersen")).toBeLessThan(0.3);
  });

  it("classifies email addresses", () => {
    expect(classifyEmail("info@bedrijf.nl")).toBe("generic");
    expect(classifyEmail("afspraken@praktijk.nl")).toBe("generic");
    expect(classifyEmail("jan.devries@bedrijf.nl")).toBe("personal");
    expect(classifyEmail("tandarts@praktijk.nl")).toBe("unknown");
  });
});

describe("cleanBusinessName", () => {
  it("drops SEO keywords after a separator", async () => {
    const { cleanBusinessName } = await import("@/server/discovery/normalize");
    expect(cleanBusinessName("The AI Agency Nederland | AI Agency | ai agency")).toBe("The AI Agency Nederland");
    expect(cleanBusinessName("Bakkerij Jansen • Brood & Banket")).toBe("Bakkerij Jansen");
    expect(cleanBusinessName("Smit & Zonen B.V.")).toBe("Smit & Zonen B.V.");
    expect(cleanBusinessName("A|B Studio")).toBe("A|B Studio");
  });
});

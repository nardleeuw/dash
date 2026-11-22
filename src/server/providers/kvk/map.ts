import type { DiscoveredBusiness } from "../types";
import type { KvkAdres, KvkBasisprofiel, KvkSearchResult, KvkVestigingsprofiel } from "./types";
import { industryFromSbi } from "@/config/industries";
import { normalizePostalCode, normalizeUrl } from "@/server/discovery/normalize";

export const KVK_ATTRIBUTION = "Bron: KVK Handelsregister";

export function mapSearchResult(r: KvkSearchResult, isMock = false): DiscoveredBusiness {
  const a = r.adres?.binnenlandsAdres;
  return {
    provider: "kvk",
    externalId: r.vestigingsnummer ? `${r.kvkNummer}:${r.vestigingsnummer}` : r.kvkNummer,
    name: r.naam,
    kvkNumber: r.kvkNummer,
    establishmentNumber: r.vestigingsnummer ?? null,
    kvkType: r.type ?? null,
    address: {
      street: a?.straatnaam ?? null,
      houseNumber: a?.huisnummer != null ? String(a.huisnummer) + (a.huisletter ?? "") : null,
      postalCode: normalizePostalCode(a?.postcode),
      city: a?.plaats ?? null,
      country: "NL",
    },
    coordinatesShareable: true,
    categories: [],
    businessStatus: r.actief === "Nee" ? "inactive" : "active",
    isMock,
    attribution: KVK_ATTRIBUTION,
  };
}

export function visitingAddress(adressen?: KvkAdres[]): KvkAdres | undefined {
  return adressen?.find((a) => a.type === "bezoekadres") ?? adressen?.find((a) => a.type !== "correspondentieadres") ?? adressen?.[0];
}

export type KvkLocationRecord = {
  establishmentNumber: string;
  isMain: boolean;
  name: string | null;
  tradeNames: string[];
  street: string | null;
  houseNumber: string | null;
  houseNumberAddition: string | null;
  postalCode: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  websites: string[];
  sbiCodes: string[];
  employees: number | null;
  nonMailing: boolean;
  addressShielded: boolean;
};

export function mapVestiging(v: KvkVestigingsprofiel): KvkLocationRecord {
  const adr = visitingAddress(v.adressen);
  return {
    establishmentNumber: v.vestigingsnummer,
    isMain: v.indHoofdvestiging === "Ja",
    name: v.eersteHandelsnaam ?? null,
    tradeNames: (v.handelsnamen ?? []).sort((a, b) => a.volgorde - b.volgorde).map((h) => h.naam),
    street: adr?.straatnaam ?? null,
    houseNumber: adr?.huisnummer != null ? String(adr.huisnummer) : null,
    houseNumberAddition: adr?.huisnummerToevoeging ?? adr?.huisletter ?? null,
    postalCode: normalizePostalCode(adr?.postcode),
    city: adr?.plaats ?? null,
    lat: adr?.geoData?.gpsLatitude ?? null,
    lng: adr?.geoData?.gpsLongitude ?? null,
    websites: (v.websites ?? []).map((w) => normalizeUrl(w)).filter((w): w is string => !!w),
    sbiCodes: (v.sbiActiviteiten ?? []).map((s) => s.sbiCode),
    employees: v.totaalWerkzamePersonen ?? null,
    nonMailing: v.indNonMailing === "Ja",
    addressShielded: adr?.indAfgeschermd === "Ja",
  };
}

export type KvkCompanyRecord = {
  kvkNumber: string;
  name: string;
  legalName: string | null;
  legalForm: string | null;
  tradeNames: string[];
  sbiCodes: string[];
  sbiDescriptions: Record<string, string>;
  primarySbi: string | null;
  industry: string | null;
  employees: number | null;
  registrationDate: string | null;
  nonMailing: boolean;
  websites: string[];
  mainLocation: KvkLocationRecord | null;
};

export function mapBasisprofiel(b: KvkBasisprofiel): KvkCompanyRecord {
  const sbi = b.sbiActiviteiten ?? [];
  const primary = sbi.find((s) => s.indHoofdactiviteit === "Ja") ?? sbi[0];
  const main = b._embedded?.hoofdvestiging ? mapVestiging(b._embedded.hoofdvestiging) : null;
  const websites = [
    ...(b._embedded?.eigenaar?.websites ?? []),
    ...(b._embedded?.hoofdvestiging?.websites ?? []),
  ].map((w) => normalizeUrl(w)).filter((w): w is string => !!w);
  const reg = b.formeleRegistratiedatum;
  return {
    kvkNumber: b.kvkNummer,
    name: b.handelsnamen?.sort((x, y) => x.volgorde - y.volgorde)[0]?.naam ?? b.naam,
    legalName: b.statutaireNaam ?? null,
    legalForm: b._embedded?.eigenaar?.uitgebreideRechtsvorm ?? b._embedded?.eigenaar?.rechtsvorm ?? null,
    tradeNames: (b.handelsnamen ?? []).map((h) => h.naam),
    sbiCodes: sbi.map((s) => s.sbiCode),
    sbiDescriptions: Object.fromEntries(sbi.map((s) => [s.sbiCode, s.sbiOmschrijving])),
    primarySbi: primary?.sbiCode ?? null,
    industry: industryFromSbi(sbi.map((s) => s.sbiCode)),
    employees: b.totaalWerkzamePersonen ?? null,
    registrationDate: reg && reg.length === 8 ? `${reg.slice(0, 4)}-${reg.slice(4, 6)}-${reg.slice(6, 8)}` : null,
    // indNonMailing on the company OR on the main establishment means: no unsolicited advertising.
    nonMailing: b.indNonMailing === "Ja" || main?.nonMailing === true,
    websites: [...new Set(websites)],
    mainLocation: main,
  };
}

export function employeeRange(n: number | null | undefined): string | null {
  if (n == null) return null;
  if (n <= 1) return "1";
  if (n <= 4) return "2-4";
  if (n <= 9) return "5-9";
  if (n <= 19) return "10-19";
  if (n <= 49) return "20-49";
  if (n <= 99) return "50-99";
  if (n <= 249) return "100-249";
  return "250+";
}

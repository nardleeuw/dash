import type { KvkApi, KvkSearchParams } from "./client";
import type { KvkBasisprofiel, KvkSearchResponse, KvkVestigingsprofiel } from "./types";

/**
 * Deterministic mock KVK used when no key is configured (never in production).
 * All names carry the "[Demo]" prefix so they cannot be mistaken for real data.
 */
const CITIES = ["Utrecht", "Amsterdam", "Rotterdam", "Den Haag", "Eindhoven", "Groningen", "Zwolle", "Arnhem"];

function seeded(n: number) {
  let x = n;
  return () => ((x = (x * 9301 + 49297) % 233280) / 233280);
}

export class MockKvk implements KvkApi {
  readonly isTestEnvironment = true;

  async search(params: KvkSearchParams): Promise<KvkSearchResponse> {
    const base = (params.naam ?? params.plaats ?? "bedrijf").trim();
    const page = params.pagina ?? 1;
    const per = Math.min(params.resultatenPerPagina ?? 25, 100);
    const total = 42;
    const start = (page - 1) * per;
    const rand = seeded(base.length * 31 + page);
    const resultaten = Array.from({ length: Math.max(0, Math.min(per, total - start)) }, (_, i) => {
      const n = start + i;
      const kvk = String(90000000 + ((base.charCodeAt(0) || 65) * 1000 + n) % 9999999).padStart(8, "9");
      const city = params.plaats ?? CITIES[Math.floor(rand() * CITIES.length)];
      return {
        kvkNummer: kvk,
        vestigingsnummer: String(990000000000 + n),
        naam: `[Demo] ${base.charAt(0).toUpperCase() + base.slice(1)} ${n + 1}`,
        type: "hoofdvestiging",
        adres: { binnenlandsAdres: { type: "bezoekadres", straatnaam: "Demostraat", huisnummer: n + 1, postcode: "3511AA", plaats: city } },
      };
    });
    return { pagina: page, resultatenPerPagina: per, totaal: total, resultaten };
  }

  async basisprofiel(kvkNumber: string): Promise<KvkBasisprofiel | null> {
    return {
      kvkNummer: kvkNumber,
      indNonMailing: "Nee",
      naam: `[Demo] Bedrijf ${kvkNumber}`,
      statutaireNaam: `[Demo] Bedrijf ${kvkNumber} B.V.`,
      totaalWerkzamePersonen: 6,
      handelsnamen: [{ naam: `[Demo] Bedrijf ${kvkNumber}`, volgorde: 0 }],
      sbiActiviteiten: [{ sbiCode: "86230", sbiOmschrijving: "Tandartspraktijken", indHoofdactiviteit: "Ja" }],
      _embedded: {
        eigenaar: { rechtsvorm: "Besloten vennootschap", uitgebreideRechtsvorm: "Besloten vennootschap" },
        hoofdvestiging: await this.vestigingsprofiel(`99${kvkNumber}00`),
      } as KvkBasisprofiel["_embedded"],
    };
  }

  async vestigingen() {
    return null;
  }

  async vestigingsprofiel(establishmentNumber: string): Promise<KvkVestigingsprofiel> {
    return {
      vestigingsnummer: establishmentNumber.padStart(12, "9").slice(-12),
      kvkNummer: establishmentNumber.slice(2, 10),
      indNonMailing: "Nee",
      eersteHandelsnaam: `[Demo] Vestiging ${establishmentNumber}`,
      indHoofdvestiging: "Ja",
      totaalWerkzamePersonen: 6,
      adressen: [{ type: "bezoekadres", straatnaam: "Demostraat", huisnummer: 1, postcode: "3511AA", plaats: "Utrecht", geoData: { gpsLatitude: 52.09, gpsLongitude: 5.12 } }],
      websites: [],
      sbiActiviteiten: [{ sbiCode: "86230", sbiOmschrijving: "Tandartspraktijken", indHoofdactiviteit: "Ja" }],
    };
  }

  async naamgeving() {
    return null;
  }
}

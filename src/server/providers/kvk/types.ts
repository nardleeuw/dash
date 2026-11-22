/** Shapes of the KVK Handelsregister API responses we consume. */
export type KvkLink = { rel: string; href: string };

export type KvkSearchResult = {
  kvkNummer: string;
  vestigingsnummer?: string;
  naam: string;
  adres?: { binnenlandsAdres?: { type?: string; straatnaam?: string; huisnummer?: number; huisletter?: string; postcode?: string; plaats?: string }; buitenlandsAdres?: unknown };
  type?: "hoofdvestiging" | "nevenvestiging" | "rechtspersoon" | string;
  actief?: string;
  vervallenNaam?: string;
  links?: KvkLink[];
};

export type KvkSearchResponse = {
  pagina: number;
  resultatenPerPagina: number;
  totaal: number;
  resultaten: KvkSearchResult[];
  vorige?: string;
  volgende?: string;
};

export type KvkAdres = {
  type: string;
  indAfgeschermd?: string;
  volledigAdres?: string;
  straatnaam?: string;
  huisnummer?: number;
  huisnummerToevoeging?: string;
  huisletter?: string;
  postcode?: string;
  postbusnummer?: number;
  plaats?: string;
  land?: string;
  geoData?: { gpsLatitude?: number; gpsLongitude?: number };
};

export type KvkSbi = { sbiCode: string; sbiOmschrijving: string; indHoofdactiviteit?: string };

export type KvkVestigingsprofiel = {
  vestigingsnummer: string;
  kvkNummer: string;
  rsin?: string;
  indNonMailing?: string;
  formeleRegistratiedatum?: string;
  statutaireNaam?: string;
  eersteHandelsnaam?: string;
  indHoofdvestiging?: string;
  indCommercieleVestiging?: string;
  totaalWerkzamePersonen?: number;
  handelsnamen?: { naam: string; volgorde: number }[];
  adressen?: KvkAdres[];
  websites?: string[];
  sbiActiviteiten?: KvkSbi[];
};

export type KvkBasisprofiel = {
  kvkNummer: string;
  indNonMailing?: string;
  naam: string;
  formeleRegistratiedatum?: string;
  totaalWerkzamePersonen?: number;
  statutaireNaam?: string;
  handelsnamen?: { naam: string; volgorde: number }[];
  sbiActiviteiten?: KvkSbi[];
  _embedded?: {
    eigenaar?: { rsin?: string; rechtsvorm?: string; uitgebreideRechtsvorm?: string; websites?: string[] };
    hoofdvestiging?: KvkVestigingsprofiel;
  };
};

export type KvkVestigingenLijst = {
  kvkNummer: string;
  totaalAantalVestigingen?: number;
  vestigingen: { vestigingsnummer: string; eersteHandelsnaam?: string; indHoofdvestiging?: string; volledigAdres?: string }[];
};

export type KvkNaamgeving = {
  kvkNummer: string;
  statutaireNaam?: string;
  naam?: string;
  vestigingen?: { vestigingsnummer: string; eersteHandelsnaam?: string; handelsnamen?: { naam: string; volgorde: number }[] }[];
};

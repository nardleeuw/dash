/**
 * Industry taxonomy used across discovery, scoring and email generation.
 * SBI prefixes are indicative (SBI 2008 as returned by KVK) and only used to
 * filter companies whose SBI codes are already known; KVK search itself does
 * not filter on SBI. Google types follow Places API (New) "Table A".
 */
export type Industry = {
  key: string;
  nl: string;
  en: string;
  sbi: string[];
  googleType?: string;
  googleQuery: { nl: string; en: string };
  osm: string[]; // Overpass tag filters, e.g. '["amenity"="dentist"]'
};

export const INDUSTRIES: Industry[] = [
  { key: "dental", nl: "Tandartspraktijken", en: "Dental clinics", sbi: ["8623"], googleType: "dentist", googleQuery: { nl: "tandarts", en: "dentist" }, osm: ['["amenity"="dentist"]', '["healthcare"="dentist"]'] },
  { key: "general_practice", nl: "Huisartsen", en: "General practitioners", sbi: ["8621"], googleType: "doctor", googleQuery: { nl: "huisarts", en: "general practitioner" }, osm: ['["amenity"="doctors"]'] },
  { key: "physiotherapy", nl: "Fysiotherapie", en: "Physiotherapy", sbi: [], googleType: "physiotherapist", googleQuery: { nl: "fysiotherapeut", en: "physiotherapist" }, osm: ['["healthcare"="physiotherapist"]'] },
  { key: "veterinary", nl: "Dierenartsen", en: "Veterinarians", sbi: ["7500"], googleType: "veterinary_care", googleQuery: { nl: "dierenarts", en: "veterinarian" }, osm: ['["amenity"="veterinary"]'] },
  { key: "hair_salon", nl: "Kappers", en: "Hair salons", sbi: ["96021"], googleType: "hair_salon", googleQuery: { nl: "kapper", en: "hair salon" }, osm: ['["shop"="hairdresser"]'] },
  { key: "beauty_salon", nl: "Schoonheidssalons", en: "Beauty salons", sbi: ["96022"], googleType: "beauty_salon", googleQuery: { nl: "schoonheidssalon", en: "beauty salon" }, osm: ['["shop"="beauty"]'] },
  { key: "fitness", nl: "Sportscholen & fitness", en: "Gyms & fitness", sbi: ["9313"], googleType: "gym", googleQuery: { nl: "sportschool", en: "gym" }, osm: ['["leisure"="fitness_centre"]'] },
  { key: "restaurant", nl: "Restaurants", en: "Restaurants", sbi: ["5610"], googleType: "restaurant", googleQuery: { nl: "restaurant", en: "restaurant" }, osm: ['["amenity"="restaurant"]'] },
  { key: "cafe", nl: "Cafés & lunchrooms", en: "Cafés", sbi: ["5630"], googleType: "cafe", googleQuery: { nl: "lunchroom café", en: "café" }, osm: ['["amenity"="cafe"]'] },
  { key: "hotel", nl: "Hotels & B&B's", en: "Hotels & B&Bs", sbi: ["5510", "5520"], googleType: "lodging", googleQuery: { nl: "hotel", en: "hotel" }, osm: ['["tourism"="hotel"]', '["tourism"="guest_house"]'] },
  { key: "real_estate", nl: "Makelaars", en: "Real estate agents", sbi: ["6831"], googleType: "real_estate_agency", googleQuery: { nl: "makelaar", en: "real estate agent" }, osm: ['["office"="estate_agent"]'] },
  { key: "plumbing_hvac", nl: "Installatiebedrijven (loodgieter, CV, klimaat)", en: "Installers (plumbing, heating, HVAC)", sbi: ["4322"], googleType: "plumber", googleQuery: { nl: "installatiebedrijf", en: "plumbing and heating installer" }, osm: ['["craft"="plumber"]', '["craft"="hvac"]', '["craft"="heating_engineer"]'] },
  { key: "electrician", nl: "Elektriciens", en: "Electricians", sbi: ["4321"], googleType: "electrician", googleQuery: { nl: "elektricien", en: "electrician" }, osm: ['["craft"="electrician"]'] },
  { key: "construction", nl: "Bouw- en aannemersbedrijven", en: "Construction & contractors", sbi: ["4120", "4399"], googleType: "general_contractor", googleQuery: { nl: "aannemer", en: "general contractor" }, osm: ['["craft"="builder"]', '["office"="construction_company"]'] },
  { key: "roofing", nl: "Dakdekkers", en: "Roofers", sbi: ["4391"], googleType: "roofing_contractor", googleQuery: { nl: "dakdekker", en: "roofer" }, osm: ['["craft"="roofer"]'] },
  { key: "painter", nl: "Schilders", en: "Painters", sbi: ["4334"], googleType: "painter", googleQuery: { nl: "schildersbedrijf", en: "painter" }, osm: ['["craft"="painter"]'] },
  { key: "cleaning", nl: "Schoonmaakbedrijven", en: "Cleaning companies", sbi: ["8121", "8122"], googleType: undefined, googleQuery: { nl: "schoonmaakbedrijf", en: "cleaning company" }, osm: ['["craft"="cleaning"]', '["office"="cleaning"]'] },
  { key: "car_repair", nl: "Autogarages", en: "Car repair", sbi: ["4520"], googleType: "car_repair", googleQuery: { nl: "autogarage", en: "car repair" }, osm: ['["shop"="car_repair"]'] },
  { key: "car_dealer", nl: "Autodealers", en: "Car dealers", sbi: ["4511"], googleType: "car_dealer", googleQuery: { nl: "autobedrijf", en: "car dealer" }, osm: ['["shop"="car"]'] },
  { key: "driving_school", nl: "Rijscholen", en: "Driving schools", sbi: ["8553"], googleType: "driving_school", googleQuery: { nl: "rijschool", en: "driving school" }, osm: ['["amenity"="driving_school"]'] },
  { key: "legal", nl: "Advocaten & juristen", en: "Lawyers", sbi: ["6910"], googleType: "lawyer", googleQuery: { nl: "advocatenkantoor", en: "law firm" }, osm: ['["office"="lawyer"]'] },
  { key: "accounting", nl: "Accountants & administratie", en: "Accountants", sbi: ["6920"], googleType: "accounting", googleQuery: { nl: "accountantskantoor", en: "accountant" }, osm: ['["office"="accountant"]', '["office"="tax_advisor"]'] },
  { key: "insurance", nl: "Verzekeringsadviseurs", en: "Insurance brokers", sbi: ["6622"], googleType: "insurance_agency", googleQuery: { nl: "verzekeringsadviseur", en: "insurance broker" }, osm: ['["office"="insurance"]'] },
  { key: "florist", nl: "Bloemisten", en: "Florists", sbi: ["47761"], googleType: "florist", googleQuery: { nl: "bloemist", en: "florist" }, osm: ['["shop"="florist"]'] },
  { key: "bakery", nl: "Bakkerijen", en: "Bakeries", sbi: ["1071", "4724"], googleType: "bakery", googleQuery: { nl: "bakkerij", en: "bakery" }, osm: ['["shop"="bakery"]'] },
  { key: "optician", nl: "Opticiens", en: "Opticians", sbi: ["47782"], googleType: undefined, googleQuery: { nl: "opticien", en: "optician" }, osm: ['["shop"="optician"]'] },
  { key: "childcare", nl: "Kinderopvang", en: "Childcare", sbi: ["8891"], googleType: "child_care_agency", googleQuery: { nl: "kinderopvang", en: "childcare" }, osm: ['["amenity"="childcare"]', '["amenity"="kindergarten"]'] },
  { key: "photography", nl: "Fotografen", en: "Photographers", sbi: ["7420"], googleType: undefined, googleQuery: { nl: "fotograaf", en: "photographer" }, osm: ['["craft"="photographer"]', '["shop"="photo"]'] },
  { key: "retail_fashion", nl: "Kledingwinkels", en: "Fashion retail", sbi: ["4771"], googleType: "clothing_store", googleQuery: { nl: "kledingwinkel", en: "clothing store" }, osm: ['["shop"="clothes"]'] },
  { key: "gardening", nl: "Hoveniers", en: "Landscapers", sbi: ["8130"], googleType: undefined, googleQuery: { nl: "hovenier", en: "landscaper" }, osm: ['["craft"="gardener"]'] },
];

export const INDUSTRY_BY_KEY = new Map(INDUSTRIES.map((i) => [i.key, i]));

/** Best-effort industry key for a set of SBI codes. */
export function industryFromSbi(codes: string[]): string | null {
  for (const code of codes) {
    for (const ind of INDUSTRIES) {
      if (ind.sbi.some((p) => code.startsWith(p))) return ind.key;
    }
  }
  return null;
}

/** Best-effort industry key for Google place types. */
export function industryFromGoogleTypes(types: string[]): string | null {
  for (const ind of INDUSTRIES) if (ind.googleType && types.includes(ind.googleType)) return ind.key;
  return null;
}

export function industryLabel(key: string | null | undefined, locale: "nl" | "en" = "nl") {
  if (!key) return null;
  const ind = INDUSTRY_BY_KEY.get(key);
  return ind ? ind[locale] : key;
}

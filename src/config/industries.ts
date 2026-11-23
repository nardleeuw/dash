/**
 * Industry taxonomy used across discovery, scoring and email generation.
 * SBI prefixes are indicative (SBI 2008 as returned by KVK) and only used to
 * filter companies whose SBI codes are already known; KVK search itself does
 * not filter on SBI. Google types follow Places API (New) "Table A" and are
 * only set where the type is certain (an unknown includedType fails the
 * request); the text queries alone already target the right businesses.
 */
export type Industry = {
  key: string;
  nl: string;
  en: string;
  sbi: string[];
  googleType?: string;
  /** Main Google text query. */
  googleQuery: { nl: string; en: string };
  /** Extra Google text queries: each surfaces places the main query misses. */
  variants: { nl: string[]; en: string[] };
  /** Search words for the industry picker (lower case). */
  aliases: string[];
  osm: string[]; // Overpass tag filters, e.g. '["amenity"="dentist"]'
  group: IndustryGroup;
};

export type IndustryGroup = "agencies" | "zorg" | "beauty" | "horeca" | "retail" | "bouw" | "auto" | "zakelijk" | "vrije_tijd" | "diensten";

export const INDUSTRY_GROUPS: Record<IndustryGroup, { nl: string; en: string }> = {
  agencies: { nl: "Agencies & bureaus", en: "Agencies" },
  zorg: { nl: "Zorg & welzijn", en: "Health & care" },
  beauty: { nl: "Beauty & verzorging", en: "Beauty & personal care" },
  horeca: { nl: "Horeca", en: "Food & drink" },
  retail: { nl: "Winkels", en: "Retail" },
  bouw: { nl: "Bouw, installatie & wonen", en: "Construction & home" },
  auto: { nl: "Auto & mobiliteit", en: "Automotive & mobility" },
  zakelijk: { nl: "Zakelijke dienstverlening", en: "Professional services" },
  vrije_tijd: { nl: "Sport, recreatie & onderwijs", en: "Leisure, sport & education" },
  diensten: { nl: "Overige diensten", en: "Other services" },
};

type Opts = { sbi?: string[]; type?: string; variants?: [string[], string[]]; aliases?: string[]; osm?: string[] };
function I(group: IndustryGroup, key: string, nl: string, en: string, query: [string, string], o: Opts = {}): Industry {
  return {
    key, nl, en, group, sbi: o.sbi ?? [], googleType: o.type, googleQuery: { nl: query[0], en: query[1] },
    variants: { nl: o.variants?.[0] ?? [], en: o.variants?.[1] ?? [] }, aliases: o.aliases ?? [], osm: o.osm ?? [],
  };
}

export const INDUSTRIES: Industry[] = [
  // Agencies & bureaus
  I("agencies", "webdesign", "Webdesignbureaus & websitebouwers", "Web design agencies", ["webdesign bureau", "web design agency"], { sbi: ["6201", "7410"], variants: [["websitebouwer", "webbureau", "wordpress bureau"], ["website developer"]], aliases: ["webdesign", "webbureau", "website", "wordpress", "webdevelopment", "internetbureau"], osm: ['["office"="it"]'] }),
  I("agencies", "marketing_agency", "Marketing- & online marketingbureaus", "Marketing agencies", ["marketingbureau", "marketing agency"], { sbi: ["7311", "7021"], variants: [["online marketing bureau", "digital agency", "social media bureau"], ["digital marketing agency", "social media agency"]], aliases: ["marketing", "online marketing", "digital", "social media", "growth"], osm: ['["office"="advertising_agency"]'] }),
  I("agencies", "seo_sea", "SEO- & SEA-bureaus", "SEO & SEA agencies", ["seo bureau", "seo agency"], { variants: [["google ads bureau", "zoekmachinemarketing"], ["google ads agency"]], aliases: ["seo", "sea", "google ads", "zoekmachine", "vindbaarheid"] }),
  I("agencies", "ai_automation", "AI- & automatiseringsbureaus", "AI & automation agencies", ["ai bureau", "ai agency"], { variants: [["ai automatisering", "automatiseringsbureau", "chatbot bedrijf", "ai receptionist"], ["automation agency", "chatbot company"]], aliases: ["ai", "kunstmatige intelligentie", "automatisering", "chatbot", "no-code", "make", "zapier"] }),
  I("agencies", "advertising_branding", "Reclame-, communicatie- & brandingbureaus", "Advertising & branding agencies", ["reclamebureau", "advertising agency"], { sbi: ["7311"], variants: [["communicatiebureau", "brandingbureau", "creatief bureau"], ["branding agency", "creative agency"]], aliases: ["reclame", "communicatie", "branding", "creatief", "campagne"], osm: ['["office"="advertising_agency"]'] }),
  I("agencies", "graphic_design", "Grafisch ontwerpers & ontwerpbureaus", "Graphic designers", ["grafisch ontwerpbureau", "graphic design studio"], { sbi: ["7410"], variants: [["grafisch ontwerper", "ontwerpstudio"], ["graphic designer"]], aliases: ["grafisch", "ontwerp", "design", "logo", "huisstijl"] }),
  I("agencies", "video_content", "Video-, content- & copywritingbureaus", "Video, content & copywriting", ["videoproductie", "video production company"], { variants: [["contentbureau", "copywriter", "animatiestudio"], ["content agency", "copywriter"]], aliases: ["video", "content", "copywriting", "animatie", "podcast"] }),
  I("agencies", "app_development", "App- & softwarebureaus", "App & software agencies", ["app ontwikkelaar", "app development company"], { sbi: ["6201"], variants: [["softwarebureau", "maatwerk software"], ["software agency"]], aliases: ["app", "software", "saas", "maatwerk", "developers"], osm: ['["office"="it"]'] }),

  // Zorg & welzijn
  I("zorg", "dental", "Tandartspraktijken", "Dental clinics", ["tandarts", "dentist"], { sbi: ["8623"], type: "dentist", variants: [["tandartspraktijk", "mondzorg"], ["dental clinic"]], aliases: ["tandarts", "mondhygiënist", "orthodontist", "mondzorg"], osm: ['["amenity"="dentist"]', '["healthcare"="dentist"]'] }),
  I("zorg", "general_practice", "Huisartsen", "General practitioners", ["huisarts", "general practitioner"], { sbi: ["8621"], type: "doctor", variants: [["huisartsenpraktijk"], []], aliases: ["dokter", "arts"], osm: ['["amenity"="doctors"]'] }),
  I("zorg", "physiotherapy", "Fysiotherapie", "Physiotherapy", ["fysiotherapeut", "physiotherapist"], { type: "physiotherapist", variants: [["fysiotherapie praktijk", "manueel therapeut"], []], aliases: ["fysio", "manuele therapie", "oefentherapie"], osm: ['["healthcare"="physiotherapist"]'] }),
  I("zorg", "veterinary", "Dierenartsen", "Veterinarians", ["dierenarts", "veterinarian"], { sbi: ["7500"], type: "veterinary_care", variants: [["dierenkliniek"], []], aliases: ["dierenkliniek"], osm: ['["amenity"="veterinary"]'] }),
  I("zorg", "pharmacy", "Apotheken", "Pharmacies", ["apotheek", "pharmacy"], { sbi: ["4773"], type: "pharmacy", osm: ['["amenity"="pharmacy"]'] }),
  I("zorg", "psychology", "Psychologen & therapeuten", "Psychologists & therapists", ["psycholoog", "psychologist"], { sbi: ["8690"], variants: [["psychotherapeut", "praktijk voor psychologie", "coach therapeut"], ["therapist"]], aliases: ["therapie", "ggz", "coach", "psychotherapie"], osm: ['["healthcare"="psychotherapist"]', '["healthcare"="psychologist"]'] }),
  I("zorg", "alternative_care", "Osteopaten, chiropractors & alternatieve zorg", "Osteopaths & chiropractors", ["osteopaat", "osteopath"], { variants: [["chiropractor", "acupunctuur", "natuurgeneeskunde"], ["chiropractor"]], aliases: ["chiropractor", "acupunctuur", "homeopathie"], osm: ['["healthcare"="alternative"]'] }),
  I("zorg", "speech_therapy", "Logopedisten", "Speech therapists", ["logopedist", "speech therapist"], { aliases: ["logopedie"], osm: ['["healthcare"="speech_therapist"]'] }),
  I("zorg", "dietitian", "Diëtisten", "Dietitians", ["diëtist", "dietitian"], { aliases: ["voedingscoach", "voeding"], osm: ['["healthcare"="dietitian"]'] }),
  I("zorg", "podiatry", "Podotherapeuten & pedicures", "Podiatrists", ["podotherapeut", "podiatrist"], { variants: [["pedicure"], []], aliases: ["pedicure", "voetzorg"], osm: ['["healthcare"="podiatrist"]'] }),
  I("zorg", "midwife", "Verloskundigen", "Midwives", ["verloskundige", "midwife"], { aliases: ["verloskunde"], osm: ['["healthcare"="midwife"]'] }),
  I("zorg", "home_care", "Thuiszorg", "Home care", ["thuiszorg", "home care"], { sbi: ["8810"], aliases: ["zorgverlener", "wijkverpleging"] }),
  I("zorg", "optician", "Opticiens", "Opticians", ["opticien", "optician"], { sbi: ["47782"], aliases: ["brillen", "oogzorg"], osm: ['["shop"="optician"]'] }),
  I("zorg", "hearing", "Audiciens", "Hearing care", ["audicien", "hearing aid store"], { aliases: ["hoortoestel"], osm: ['["shop"="hearing_aids"]'] }),

  // Beauty & verzorging
  I("beauty", "hair_salon", "Kappers & barbiers", "Hair salons & barbers", ["kapper", "hair salon"], { sbi: ["96021"], type: "hair_salon", variants: [["kapsalon", "barbier"], ["barber"]], aliases: ["kapsalon", "barbier", "barber", "haar"], osm: ['["shop"="hairdresser"]'] }),
  I("beauty", "beauty_salon", "Schoonheidssalons", "Beauty salons", ["schoonheidssalon", "beauty salon"], { sbi: ["96022"], type: "beauty_salon", variants: [["huidtherapeut", "salon wimpers"], []], aliases: ["beauty", "huidverzorging", "wimpers", "visagie"], osm: ['["shop"="beauty"]'] }),
  I("beauty", "nail_salon", "Nagelstudio's", "Nail salons", ["nagelstudio", "nail salon"], { aliases: ["nagels", "manicure"] }),
  I("beauty", "massage_spa", "Massage, wellness & sauna", "Massage, spa & sauna", ["massagesalon", "massage"], { type: "spa", variants: [["wellness", "sauna"], ["spa", "sauna"]], aliases: ["massage", "spa", "wellness", "sauna"], osm: ['["shop"="massage"]', '["leisure"="sauna"]'] }),
  I("beauty", "tattoo", "Tattoo- & piercingshops", "Tattoo & piercing", ["tattooshop", "tattoo shop"], { aliases: ["tattoo", "piercing"], osm: ['["shop"="tattoo"]'] }),
  I("beauty", "tanning", "Zonnestudio's", "Tanning studios", ["zonnestudio", "tanning salon"], { aliases: ["zonnebank"], osm: ['["shop"="tanning"]', '["leisure"="tanning_salon"]'] }),

  // Horeca
  I("horeca", "restaurant", "Restaurants", "Restaurants", ["restaurant", "restaurant"], { sbi: ["5610"], type: "restaurant", variants: [["eetcafé", "bistro", "pizzeria"], ["bistro"]], aliases: ["eetcafé", "bistro", "pizzeria", "horeca", "eten"], osm: ['["amenity"="restaurant"]'] }),
  I("horeca", "cafe", "Cafés & lunchrooms", "Cafés & lunchrooms", ["café", "café"], { sbi: ["5630"], type: "cafe", variants: [["lunchroom", "koffiebar", "brunch"], ["coffee shop", "lunchroom"]], aliases: ["lunchroom", "koffiebar", "koffie", "brunch", "horeca", "lunch"], osm: ['["amenity"="cafe"]'] }),
  I("horeca", "bar", "Bars & kroegen", "Bars & pubs", ["bar", "bar"], { sbi: ["5630"], type: "bar", variants: [["kroeg", "bruin café", "cocktailbar"], ["pub"]], aliases: ["kroeg", "pub", "cocktailbar", "uitgaan", "horeca"], osm: ['["amenity"="bar"]', '["amenity"="pub"]'] }),
  I("horeca", "takeaway", "Snackbars & afhaal", "Takeaway & fast food", ["snackbar", "takeaway"], { sbi: ["5610"], type: "meal_takeaway", variants: [["cafetaria", "afhaalrestaurant", "shoarma"], ["fast food"]], aliases: ["cafetaria", "friettent", "afhalen", "bezorgen", "fastfood"], osm: ['["amenity"="fast_food"]'] }),
  I("horeca", "ice_cream", "IJssalons", "Ice cream parlours", ["ijssalon", "ice cream shop"], { aliases: ["ijs", "gelato"], osm: ['["amenity"="ice_cream"]'] }),
  I("horeca", "catering", "Cateraars", "Caterers", ["catering", "catering service"], { sbi: ["5621"], aliases: ["cateraar", "partyservice"], osm: ['["craft"="caterer"]'] }),
  I("horeca", "hotel", "Hotels & B&B's", "Hotels & B&Bs", ["hotel", "hotel"], { sbi: ["5510", "5520"], type: "lodging", variants: [["bed and breakfast", "pension"], ["bed and breakfast"]], aliases: ["b&b", "bed and breakfast", "overnachten", "pension"], osm: ['["tourism"="hotel"]', '["tourism"="guest_house"]'] }),
  I("horeca", "event_venue", "Evenementen- & feestlocaties", "Event venues", ["evenementenlocatie", "event venue"], { variants: [["feestzaal", "trouwlocatie", "vergaderlocatie"], ["wedding venue"]], aliases: ["feestzaal", "trouwlocatie", "zaalverhuur", "vergaderlocatie"], osm: ['["amenity"="events_venue"]'] }),

  // Winkels
  I("retail", "bakery", "Bakkerijen", "Bakeries", ["bakkerij", "bakery"], { sbi: ["1071", "4724"], type: "bakery", variants: [["bakker", "banketbakker"], ["patisserie"]], aliases: ["bakker", "banketbakker", "patisserie"], osm: ['["shop"="bakery"]', '["shop"="pastry"]'] }),
  I("retail", "butcher", "Slagerijen", "Butchers", ["slagerij", "butcher"], { sbi: ["4722"], aliases: ["slager", "vlees"], osm: ['["shop"="butcher"]'] }),
  I("retail", "greengrocer", "Groente- & delicatessenwinkels", "Greengrocers & delis", ["groentewinkel", "greengrocer"], { variants: [["delicatessenwinkel", "kaaswinkel", "visboer"], ["deli"]], aliases: ["groenteboer", "delicatessen", "kaas", "vis", "speciaalzaak"], osm: ['["shop"="greengrocer"]', '["shop"="deli"]', '["shop"="cheese"]', '["shop"="seafood"]'] }),
  I("retail", "supermarket", "Supermarkten & toko's", "Supermarkets & grocers", ["supermarkt", "supermarket"], { sbi: ["4711"], type: "supermarket", variants: [["toko", "biologische winkel"], ["grocery store"]], aliases: ["toko", "biologisch", "boodschappen"], osm: ['["shop"="supermarket"]', '["shop"="convenience"]'] }),
  I("retail", "liquor", "Slijterijen & wijnwinkels", "Liquor & wine shops", ["slijterij", "liquor store"], { type: "liquor_store", variants: [["wijnwinkel", "wijnhandel"], ["wine shop"]], aliases: ["wijn", "bier", "drank"], osm: ['["shop"="alcohol"]', '["shop"="wine"]'] }),
  I("retail", "florist", "Bloemisten", "Florists", ["bloemist", "florist"], { sbi: ["47761"], type: "florist", variants: [["bloemenwinkel"], []], aliases: ["bloemen", "bloemenwinkel"], osm: ['["shop"="florist"]'] }),
  I("retail", "garden_centre", "Tuincentra", "Garden centres", ["tuincentrum", "garden center"], { aliases: ["planten", "kwekerij"], osm: ['["shop"="garden_centre"]'] }),
  I("retail", "retail_fashion", "Kledingwinkels & boetieks", "Fashion retail", ["kledingwinkel", "clothing store"], { sbi: ["4771"], type: "clothing_store", variants: [["boetiek", "modezaak"], ["boutique"]], aliases: ["kleding", "mode", "boetiek", "fashion"], osm: ['["shop"="clothes"]', '["shop"="boutique"]'] }),
  I("retail", "shoes", "Schoenenwinkels", "Shoe stores", ["schoenenwinkel", "shoe store"], { type: "shoe_store", aliases: ["schoenen"], osm: ['["shop"="shoes"]'] }),
  I("retail", "jewelry", "Juweliers", "Jewellers", ["juwelier", "jewelry store"], { type: "jewelry_store", aliases: ["sieraden", "horloges"], osm: ['["shop"="jewelry"]'] }),
  I("retail", "furniture", "Meubel- & woonwinkels", "Furniture & interior stores", ["meubelwinkel", "furniture store"], { type: "furniture_store", variants: [["woonwinkel", "interieurwinkel"], ["home goods store"]], aliases: ["meubels", "interieur", "wonen", "woonwinkel"], osm: ['["shop"="furniture"]', '["shop"="interior_decoration"]'] }),
  I("retail", "kitchen_bath", "Keuken- & badkamerzaken", "Kitchen & bathroom showrooms", ["keukenzaak", "kitchen showroom"], { variants: [["badkamerzaak", "sanitairwinkel"], ["bathroom showroom"]], aliases: ["keukens", "badkamers", "sanitair"], osm: ['["shop"="kitchen"]', '["shop"="bathroom_furnishing"]'] }),
  I("retail", "flooring", "Vloeren, gordijnen & raamdecoratie", "Flooring & window furnishings", ["vloerenwinkel", "flooring store"], { variants: [["gordijnen", "raamdecoratie"], ["curtains"]], aliases: ["vloeren", "parket", "pvc vloer", "gordijnen", "zonwering"], osm: ['["shop"="flooring"]', '["shop"="curtain"]'] }),
  I("retail", "hardware", "Bouwmarkten & ijzerwaren", "Hardware stores", ["ijzerwarenwinkel", "hardware store"], { type: "hardware_store", variants: [["bouwmarkt", "gereedschap"], []], aliases: ["bouwmarkt", "gereedschap", "doe-het-zelf"], osm: ['["shop"="hardware"]', '["shop"="doityourself"]'] }),
  I("retail", "electronics", "Elektronica & telefoonwinkels", "Electronics & phone shops", ["elektronicawinkel", "electronics store"], { type: "electronics_store", variants: [["telefoonwinkel", "computerwinkel", "telefoon reparatie"], ["phone repair"]], aliases: ["telefoon", "computer", "witgoed", "reparatie"], osm: ['["shop"="electronics"]', '["shop"="mobile_phone"]', '["shop"="computer"]'] }),
  I("retail", "bicycle", "Fietsenwinkels", "Bicycle shops", ["fietsenwinkel", "bicycle store"], { type: "bicycle_store", variants: [["fietsenmaker", "e-bike winkel"], []], aliases: ["fietsenmaker", "e-bike", "fiets"], osm: ['["shop"="bicycle"]'] }),
  I("retail", "sports_store", "Sportwinkels", "Sporting goods stores", ["sportwinkel", "sporting goods store"], { aliases: ["sport"], osm: ['["shop"="sports"]', '["shop"="outdoor"]'] }),
  I("retail", "books_gifts", "Boekhandels & cadeauwinkels", "Book & gift shops", ["boekhandel", "book store"], { variants: [["cadeauwinkel", "speelgoedwinkel"], ["gift shop", "toy store"]], aliases: ["boeken", "cadeau", "speelgoed"], osm: ['["shop"="books"]', '["shop"="gift"]', '["shop"="toys"]'] }),
  I("retail", "pet_store", "Dierenwinkels & trimsalons", "Pet shops & groomers", ["dierenwinkel", "pet store"], { type: "pet_store", variants: [["trimsalon", "dierenspeciaalzaak"], ["dog groomer"]], aliases: ["huisdieren", "trimsalon", "hond", "kat"], osm: ['["shop"="pet"]', '["shop"="pet_grooming"]'] }),
  I("retail", "drugstore", "Drogisterijen & parfumerieën", "Drugstores & perfumeries", ["drogisterij", "drugstore"], { type: "drugstore", variants: [["parfumerie"], ["perfumery"]], aliases: ["parfum", "cosmetica"], osm: ['["shop"="chemist"]', '["shop"="perfumery"]', '["shop"="cosmetics"]'] }),
  I("retail", "second_hand", "Kringloop & tweedehands", "Second-hand stores", ["kringloopwinkel", "thrift store"], { variants: [["tweedehands winkel", "vintage winkel"], ["vintage store"]], aliases: ["kringloop", "vintage", "tweedehands"], osm: ['["shop"="second_hand"]', '["shop"="charity"]'] }),

  // Bouw, installatie & wonen
  I("bouw", "plumbing_hvac", "Installatiebedrijven (loodgieter, CV, klimaat)", "Installers (plumbing, heating, HVAC)", ["installatiebedrijf", "plumbing and heating installer"], { sbi: ["4322"], type: "plumber", variants: [["loodgieter", "cv monteur", "airco installateur"], ["plumber", "hvac"]], aliases: ["loodgieter", "cv", "airco", "warmtepomp", "installateur", "klimaat"], osm: ['["craft"="plumber"]', '["craft"="hvac"]', '["craft"="heating_engineer"]'] }),
  I("bouw", "electrician", "Elektriciens", "Electricians", ["elektricien", "electrician"], { sbi: ["4321"], type: "electrician", variants: [["elektrotechnisch installatiebedrijf"], []], aliases: ["elektra", "laadpaal"], osm: ['["craft"="electrician"]'] }),
  I("bouw", "solar", "Zonnepanelen & duurzame energie", "Solar & renewable energy", ["zonnepanelen installateur", "solar installer"], { variants: [["zonnepanelen bedrijf", "laadpaal installateur"], ["solar panels"]], aliases: ["zonnepanelen", "duurzaam", "energie", "laadpaal", "warmtepomp"], osm: ['["craft"="photovoltaic"]'] }),
  I("bouw", "construction", "Bouw- en aannemersbedrijven", "Construction & contractors", ["aannemer", "general contractor"], { sbi: ["4120", "4399"], type: "general_contractor", variants: [["bouwbedrijf", "verbouwing"], ["builder"]], aliases: ["bouwbedrijf", "verbouwing", "renovatie", "aannemer"], osm: ['["craft"="builder"]', '["office"="construction_company"]'] }),
  I("bouw", "carpenter", "Timmerbedrijven & klusbedrijven", "Carpenters & handymen", ["timmerman", "carpenter"], { sbi: ["4332"], variants: [["klusbedrijf", "kozijnen"], ["handyman"]], aliases: ["timmerman", "klusjesman", "kozijnen", "klus"], osm: ['["craft"="carpenter"]', '["craft"="handicraft"]'] }),
  I("bouw", "plasterer_tiler", "Stukadoors, tegelzetters & vloerenleggers", "Plasterers, tilers & floor fitters", ["stukadoor", "plasterer"], { variants: [["tegelzetter", "vloerenlegger"], ["tiler"]], aliases: ["stucwerk", "tegels", "vloeren"], osm: ['["craft"="plasterer"]', '["craft"="tiler"]', '["craft"="floorer"]'] }),
  I("bouw", "roofing", "Dakdekkers", "Roofers", ["dakdekker", "roofer"], { sbi: ["4391"], type: "roofing_contractor", aliases: ["dak", "dakwerk"], osm: ['["craft"="roofer"]'] }),
  I("bouw", "painter", "Schilders", "Painters", ["schildersbedrijf", "painter"], { sbi: ["4334"], type: "painter", variants: [["schilder"], []], aliases: ["schilder", "behanger"], osm: ['["craft"="painter"]'] }),
  I("bouw", "glazier", "Glaszetters & glazenwassers", "Glaziers & window cleaners", ["glaszetter", "glazier"], { variants: [["glazenwasser"], ["window cleaner"]], aliases: ["glas", "glazenwasser", "ramen"], osm: ['["craft"="glaziery"]', '["craft"="window_construction"]'] }),
  I("bouw", "locksmith", "Slotenmakers & beveiliging", "Locksmiths & security", ["slotenmaker", "locksmith"], { type: "locksmith", variants: [["beveiligingsbedrijf", "alarmsystemen"], ["security company"]], aliases: ["sloten", "beveiliging", "alarm", "camerabewaking"], osm: ['["craft"="locksmith"]', '["shop"="locksmith"]'] }),
  I("bouw", "gardening", "Hoveniers", "Landscapers", ["hovenier", "landscaper"], { sbi: ["8130"], variants: [["tuinonderhoud", "tuinaanleg"], ["gardener"]], aliases: ["tuin", "tuinman", "tuinonderhoud", "groen"], osm: ['["craft"="gardener"]'] }),
  I("bouw", "cleaning", "Schoonmaakbedrijven", "Cleaning companies", ["schoonmaakbedrijf", "cleaning company"], { sbi: ["8121", "8122"], variants: [["glazenwasser", "glasbewassing"], []], aliases: ["schoonmaak", "glazenwasser", "reiniging"], osm: ['["craft"="cleaning"]', '["office"="cleaning"]'] }),
  I("bouw", "moving", "Verhuisbedrijven & opslag", "Movers & storage", ["verhuisbedrijf", "moving company"], { type: "moving_company", variants: [["opslagruimte", "self storage"], ["self storage"]], aliases: ["verhuizen", "opslag", "storage"], osm: ['["office"="moving_company"]', '["shop"="storage_rental"]'] }),
  I("bouw", "architect", "Architecten & interieurontwerpers", "Architects & interior designers", ["architectenbureau", "architect"], { sbi: ["7111"], variants: [["interieurarchitect", "interieurontwerper"], ["interior designer"]], aliases: ["architect", "interieur", "ontwerp"], osm: ['["office"="architect"]'] }),
  I("bouw", "real_estate", "Makelaars", "Real estate agents", ["makelaar", "real estate agent"], { sbi: ["6831"], type: "real_estate_agency", variants: [["makelaarskantoor", "aankoopmakelaar"], []], aliases: ["vastgoed", "huizen", "woningen"], osm: ['["office"="estate_agent"]'] }),

  // Auto & mobiliteit
  I("auto", "car_repair", "Autogarages", "Car repair", ["autogarage", "car repair"], { sbi: ["4520"], type: "car_repair", variants: [["apk keuring", "autoreparatie"], ["mechanic"]], aliases: ["garage", "apk", "monteur", "autoschade"], osm: ['["shop"="car_repair"]'] }),
  I("auto", "car_dealer", "Autodealers & autobedrijven", "Car dealers", ["autobedrijf", "car dealer"], { sbi: ["4511"], type: "car_dealer", variants: [["occasions", "autodealer"], []], aliases: ["occasions", "autohandel", "dealer"], osm: ['["shop"="car"]'] }),
  I("auto", "car_body", "Autoschadeherstel & bandenservice", "Body shops & tyre services", ["autoschadeherstel", "auto body shop"], { variants: [["bandenservice", "autoruit"], ["tyre shop"]], aliases: ["schadeherstel", "banden", "autoruit", "carrosserie"], osm: ['["shop"="tyres"]', '["craft"="car_painter"]'] }),
  I("auto", "car_wash", "Autowasstraten & detailing", "Car wash & detailing", ["autowasstraat", "car wash"], { type: "car_wash", variants: [["auto detailing", "autopoetsbedrijf"], ["car detailing"]], aliases: ["wassen", "detailing", "poetsen"], osm: ['["amenity"="car_wash"]'] }),
  I("auto", "car_rental", "Auto- & busverhuur", "Car & van rental", ["autoverhuur", "car rental"], { type: "car_rental", variants: [["busverhuur", "aanhangwagen verhuur"], ["van rental"]], aliases: ["verhuur", "busje huren"], osm: ['["amenity"="car_rental"]'] }),
  I("auto", "motorcycle", "Motor- & scooterzaken", "Motorcycle & scooter shops", ["motorzaak", "motorcycle dealer"], { variants: [["scooterwinkel"], ["scooter shop"]], aliases: ["motor", "scooter"], osm: ['["shop"="motorcycle"]'] }),
  I("auto", "driving_school", "Rijscholen", "Driving schools", ["rijschool", "driving school"], { sbi: ["8553"], aliases: ["rijles", "rijbewijs"], osm: ['["amenity"="driving_school"]'] }),
  I("auto", "taxi_transport", "Taxi- & transportbedrijven", "Taxi & transport companies", ["taxibedrijf", "taxi service"], { sbi: ["4932", "4941"], variants: [["transportbedrijf", "koeriersdienst"], ["courier"]], aliases: ["taxi", "transport", "koerier", "logistiek"], osm: ['["office"="taxi"]', '["office"="logistics"]'] }),

  // Zakelijke dienstverlening
  I("zakelijk", "accounting", "Accountants & administratiekantoren", "Accountants", ["accountantskantoor", "accountant"], { sbi: ["6920"], type: "accounting", variants: [["administratiekantoor", "boekhouder", "belastingadviseur"], ["bookkeeper", "tax advisor"]], aliases: ["boekhouding", "administratie", "belasting", "boekhouder"], osm: ['["office"="accountant"]', '["office"="tax_advisor"]'] }),
  I("zakelijk", "legal", "Advocaten & juristen", "Lawyers", ["advocatenkantoor", "law firm"], { sbi: ["6910"], type: "lawyer", variants: [["advocaat", "juridisch advies"], ["lawyer"]], aliases: ["advocaat", "jurist", "juridisch"], osm: ['["office"="lawyer"]'] }),
  I("zakelijk", "notary", "Notarissen", "Notaries", ["notaris", "notary"], { sbi: ["6910"], aliases: ["notariskantoor"], osm: ['["office"="notary"]'] }),
  I("zakelijk", "financial_advice", "Financieel & hypotheekadviseurs", "Financial & mortgage advisers", ["hypotheekadviseur", "mortgage broker"], { sbi: ["6619"], variants: [["financieel adviseur", "financieel planner"], ["financial advisor"]], aliases: ["hypotheek", "financieel", "pensioen"], osm: ['["office"="financial_advisor"]', '["office"="financial"]'] }),
  I("zakelijk", "insurance", "Verzekeringsadviseurs", "Insurance brokers", ["verzekeringsadviseur", "insurance broker"], { sbi: ["6622"], type: "insurance_agency", aliases: ["verzekeringen"], osm: ['["office"="insurance"]'] }),
  I("zakelijk", "it_services", "IT-bedrijven & softwareontwikkelaars", "IT & software companies", ["it bedrijf", "it services"], { sbi: ["6201", "6202"], variants: [["softwareontwikkelaar", "computerhulp", "ict beheer"], ["software company"]], aliases: ["ict", "software", "computerhulp", "automatisering"], osm: ['["office"="it"]'] }),
  I("zakelijk", "recruitment", "Uitzend- & recruitmentbureaus", "Recruitment agencies", ["uitzendbureau", "recruitment agency"], { sbi: ["7810", "7820"], variants: [["recruitmentbureau", "detacheringsbureau"], ["staffing agency"]], aliases: ["werving", "detachering", "personeel"], osm: ['["office"="employment_agency"]'] }),
  I("zakelijk", "consulting", "Consultancy & coaching", "Consultancy & coaching", ["adviesbureau", "consultancy"], { sbi: ["7022"], variants: [["bedrijfsadvies", "business coach"], ["business coach"]], aliases: ["advies", "coach", "coaching", "consultant"], osm: ['["office"="consulting"]'] }),
  I("zakelijk", "printing", "Drukkerijen & reclamemakers", "Print shops & sign makers", ["drukkerij", "print shop"], { sbi: ["1812"], variants: [["reclamebelettering", "copyshop"], ["sign maker"]], aliases: ["drukwerk", "belettering", "printen", "copyshop"], osm: ['["shop"="copyshop"]', '["craft"="printer"]', '["craft"="signmaker"]'] }),
  I("zakelijk", "photography", "Fotografen & videografen", "Photographers & videographers", ["fotograaf", "photographer"], { sbi: ["7420"], variants: [["fotostudio", "videograaf"], ["videographer"]], aliases: ["fotografie", "video", "fotostudio"], osm: ['["craft"="photographer"]', '["shop"="photo"]'] }),
  I("zakelijk", "coworking", "Bedrijfsverzamelgebouwen & coworking", "Coworking & business centres", ["coworking", "coworking space"], { variants: [["flexplekken", "kantoorruimte huren"], ["office space"]], aliases: ["flexplek", "kantoor", "bedrijfsruimte"], osm: ['["amenity"="coworking_space"]', '["office"="coworking"]'] }),

  // Sport, recreatie & onderwijs
  I("vrije_tijd", "fitness", "Sportscholen & fitness", "Gyms & fitness", ["sportschool", "gym"], { sbi: ["9313"], type: "gym", variants: [["fitness", "crossfit", "personal trainer"], ["fitness center", "personal trainer"]], aliases: ["fitness", "crossfit", "personal trainer", "bootcamp"], osm: ['["leisure"="fitness_centre"]'] }),
  I("vrije_tijd", "yoga", "Yoga- & pilatesstudio's", "Yoga & pilates studios", ["yoga studio", "yoga studio"], { variants: [["pilates studio"], ["pilates studio"]], aliases: ["yoga", "pilates", "meditatie"], osm: ['["sport"="yoga"]'] }),
  I("vrije_tijd", "dance_music", "Dans- & muziekscholen", "Dance & music schools", ["dansschool", "dance school"], { variants: [["muziekschool", "zangles"], ["music school"]], aliases: ["dansen", "muziekles", "zangles"], osm: ['["leisure"="dance"]', '["amenity"="music_school"]'] }),
  I("vrije_tijd", "tutoring", "Bijles, taal- & opleidingsinstituten", "Tutoring & training centres", ["bijles", "tutoring"], { sbi: ["8559"], variants: [["huiswerkbegeleiding", "taalschool", "opleidingscentrum"], ["language school"]], aliases: ["huiswerkbegeleiding", "taalschool", "cursus", "training", "opleiding"], osm: ['["amenity"="language_school"]', '["office"="educational_institution"]'] }),
  I("vrije_tijd", "childcare", "Kinderopvang", "Childcare", ["kinderopvang", "childcare"], { sbi: ["8891"], type: "child_care_agency", variants: [["kinderdagverblijf", "bso", "gastouderbureau"], ["daycare"]], aliases: ["kinderdagverblijf", "bso", "gastouder", "peuterspeelzaal"], osm: ['["amenity"="childcare"]', '["amenity"="kindergarten"]'] }),
  I("vrije_tijd", "recreation", "Recreatie & uitjes", "Leisure activities", ["escape room", "escape room"], { variants: [["bowlingbaan", "lasergamen", "kinderfeestje locatie"], ["bowling alley"]], aliases: ["escape room", "bowling", "uitje", "activiteit", "kinderfeest"], osm: ['["leisure"="escape_game"]', '["leisure"="bowling_alley"]', '["leisure"="amusement_arcade"]'] }),
  I("vrije_tijd", "camping", "Campings & vakantieparken", "Campsites & holiday parks", ["camping", "campground"], { variants: [["vakantiepark", "glamping"], ["holiday park"]], aliases: ["vakantiepark", "glamping", "kamperen"], osm: ['["tourism"="camp_site"]', '["tourism"="chalet"]'] }),
  I("vrije_tijd", "equestrian", "Maneges & paardensport", "Riding schools", ["manege", "riding school"], { aliases: ["paard", "paardrijden"], osm: ['["leisure"="horse_riding"]'] }),
  I("vrije_tijd", "golf_sports_club", "Golfbanen & sportverenigingen", "Golf courses & sports clubs", ["golfbaan", "golf course"], { variants: [["tennisvereniging", "padel"], ["tennis club", "padel"]], aliases: ["golf", "tennis", "padel", "sportvereniging"], osm: ['["leisure"="golf_course"]', '["club"="sport"]'] }),

  // Overige diensten
  I("diensten", "travel_agency", "Reisbureaus", "Travel agencies", ["reisbureau", "travel agency"], { type: "travel_agency", aliases: ["reizen", "vakantie"], osm: ['["shop"="travel_agency"]'] }),
  I("diensten", "funeral", "Uitvaartondernemingen", "Funeral homes", ["uitvaartonderneming", "funeral home"], { type: "funeral_home", aliases: ["uitvaart", "begrafenis", "crematie"], osm: ['["shop"="funeral_directors"]'] }),
  I("diensten", "laundry", "Stomerijen, wasserettes & kleermakers", "Dry cleaners & tailors", ["stomerij", "dry cleaner"], { type: "laundry", variants: [["wasserette", "kleermaker"], ["tailor"]], aliases: ["wasserette", "kleermaker", "naaiatelier", "kledingreparatie"], osm: ['["shop"="dry_cleaning"]', '["shop"="laundry"]', '["craft"="tailor"]'] }),
  I("diensten", "pet_services", "Dierenpensions & hondenuitlaatservices", "Pet boarding & dog walking", ["dierenpension", "pet boarding"], { variants: [["hondenuitlaatservice", "hondenschool"], ["dog walker"]], aliases: ["hondenpension", "kattenpension", "hondenschool", "uitlaatservice"], osm: ['["amenity"="animal_boarding"]', '["amenity"="animal_training"]'] }),
  I("diensten", "wedding_events", "Bruiloft- & evenementenplanners", "Wedding & event planners", ["weddingplanner", "wedding planner"], { variants: [["evenementenbureau", "dj boeken"], ["event planner"]], aliases: ["bruiloft", "evenementen", "dj", "feest"] }),
];

export const INDUSTRY_BY_KEY = new Map(INDUSTRIES.map((i) => [i.key, i]));

/** All Google text queries for an industry (main query first). */
export function googleQueriesFor(ind: Industry, lang: "nl" | "en"): string[] {
  return [...new Set([ind.googleQuery[lang], ...ind.variants[lang]])];
}

/** Picker options: label, group and search words, sorted by label within each group. */
export function industryOptions(locale: "nl" | "en") {
  return INDUSTRIES.map((i) => ({ key: i.key, label: i[locale], group: INDUSTRY_GROUPS[i.group][locale], aliases: i.aliases }))
    .sort((a, b) => a.group.localeCompare(b.group, locale) || a.label.localeCompare(b.label, locale));
}

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

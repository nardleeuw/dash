/**
 * Estimated provider costs in micro-euros (1 EUR = 1_000_000). Used for the
 * internal cost dashboard (api_usage). Adjust to your contracts.
 */
export const PROVIDER_COST_MICROS = {
  kvk: { search: 0, basisprofiel: 20_000, vestigingsprofiel: 20_000, vestigingen: 0, naamgeving: 0 },
  google_places: { searchText: 32_000, details: 17_000 },
  osm: { overpass: 0 },
  pdok: { search: 0 },
  hunter: { domainSearch: 30_000, emailFinder: 30_000, emailVerifier: 15_000, account: 0 },
  pagespeed: { run: 0 },
} as const;

/** OpenAI hosted web search: fee per search call in micro-euros (estimate — adjust). */
export const WEB_SEARCH_CALL_MICROS = 9_500;

/** OpenAI price per 1M tokens in micro-euros [input, output]. Estimates — adjust. */
export const OPENAI_PRICE_PER_MTOK: Record<string, [number, number]> = {
  "gpt-5.5": [5_000_000, 30_000_000],
  "gpt-5.4-mini": [700_000, 4_200_000],
  "gpt-5-mini": [230_000, 1_850_000],
  default: [2_000_000, 8_000_000],
};

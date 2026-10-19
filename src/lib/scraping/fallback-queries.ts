import { ELITE_ECOSYSTEMS, ELITE_MARKETS, FIRST_ELITE_EXPERIMENT, searchTermsFor, type EliteEcosystemId } from "@/lib/elite/catalog";
import type { BusinessPolicy } from "@/lib/config/business";
import {
  DEFAULT_CAMPAIGN_CITIES,
  resolveCampaignCities,
  type CampaignIntent,
} from "@/lib/campaigns/intent";

export const FALLBACK_QUERY_CURSOR_KEY = "discover.fallbackQueryCursor";
export const FALLBACK_QUERY_BATCH = 6;

/**
 * Default Discover ecosystems when ICP industries are empty.
 * Excludes investment / PE / family office — those pull directories (tracxn, PEI)
 * that classify as REJECT and never become LinkedIn connect targets.
 */
export const DEFAULT_DISCOVER_ECOSYSTEMS: EliteEcosystemId[] = [
  "premium_healthcare",
  "luxury_hospitality",
  "luxury_real_estate",
  "luxury_retail",
  "superyacht",
  "private_aviation",
  "luxury_automotive",
];

/** Local operators who buy websites / software — used ahead of elite jargon. */
export const LOCAL_OPERATOR_QUERY_TERMS = [
  "restaurant owner",
  "hotel owner",
  "dental clinic",
  "private clinic",
  "salon spa owner",
  "real estate developer",
  "construction company",
  "cafe owner",
] as const;

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return out;
}

function geographiesFor(policy: BusinessPolicy, brief?: CampaignIntent | null) {
  const briefCities = resolveCampaignCities(brief);
  const configured = policy.icp.geographies.filter((item) => item.trim());
  // Brief cities (Karachi/Brazil + Ibiza/Mykonos + elite markets) lead the pool.
  return uniqueStrings([...briefCities, ...configured, ...ELITE_MARKETS, FIRST_ELITE_EXPERIMENT.market]);
}

function ecosystemIdsFor(policy: BusinessPolicy): EliteEcosystemId[] {
  const fromIndustries = policy.icp.industries
    .map((label) => ELITE_ECOSYSTEMS.find((eco) => eco.label.toLowerCase() === label.trim().toLowerCase())?.id)
    .filter(Boolean) as EliteEcosystemId[];
  if (fromIndustries.length) return uniqueStrings(fromIndustries) as EliteEcosystemId[];
  return [...DEFAULT_DISCOVER_ECOSYSTEMS];
}

/** Buyer-facing need phrases — avoid "enterprise PE / investment firm" style search. */
function operatorNeedTerms(brief?: CampaignIntent | null): string[] {
  const need = brief?.needCriteria?.trim();
  const extras = need
    ? [need, `small business ${need}`]
    : ["needs website", "outdated website", "no website business"];
  return uniqueStrings([...LOCAL_OPERATOR_QUERY_TERMS, ...extras]);
}

function allFallbackQueries(policy: BusinessPolicy, brief?: CampaignIntent | null) {
  const geos = geographiesFor(policy, brief);
  const ecosystems = ecosystemIdsFor(policy);
  const operatorTerms = operatorNeedTerms(brief);
  if (!geos.length || !ecosystems.length) {
    return searchTermsFor(FIRST_ELITE_EXPERIMENT.market, FIRST_ELITE_EXPERIMENT.ecosystemIds);
  }

  const pool: string[] = [];
  for (const geo of geos) {
    // Local operators first — these become Connect/email buyers after classify.
    for (const term of operatorTerms.slice(0, 6)) {
      pool.push(`${geo} ${term}`);
    }
    for (const eco of ecosystems) {
      const ecoRow = ELITE_ECOSYSTEMS.find((item) => item.id === eco);
      const terms = ecoRow?.queries.length ? ecoRow.queries : [ecoRow?.category ?? eco];
      for (const term of terms) {
        pool.push(`${geo} ${term}`);
      }
    }
  }
  return uniqueStrings(pool);
}

/** Rotate geo + ecosystem terminology so fallback search does not repeat the same six queries forever. */
export function rotatedFallbackQueries(
  policy: BusinessPolicy,
  cursor: number,
  brief?: CampaignIntent | null,
): string[] {
  const pool = allFallbackQueries(policy, brief);
  if (!pool.length) {
    const seeded = DEFAULT_CAMPAIGN_CITIES.flatMap((city) =>
      searchTermsFor(city, FIRST_ELITE_EXPERIMENT.ecosystemIds),
    );
    return (seeded.length ? seeded : searchTermsFor(FIRST_ELITE_EXPERIMENT.market, FIRST_ELITE_EXPERIMENT.ecosystemIds)).slice(
      0,
      FALLBACK_QUERY_BATCH,
    );
  }
  const start = Math.max(0, cursor) % pool.length;
  const batch: string[] = [];
  for (let index = 0; index < FALLBACK_QUERY_BATCH; index += 1) {
    batch.push(pool[(start + index) % pool.length]!);
  }
  return batch;
}

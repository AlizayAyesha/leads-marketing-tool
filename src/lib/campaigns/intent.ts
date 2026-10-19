import { OFFER_FAMILIES, type OfferFamily } from "@/lib/intelligence/offers";
import { ELITE_MARKETS } from "@/lib/elite/catalog";

/** Core + elite city targets (Karachi/Brazil + Ibiza/Mykonos + ELITE_MARKETS). */
export const DEFAULT_CAMPAIGN_CITIES = uniquePreserve([
  "Karachi",
  "São Paulo",
  "Goiânia",
  "Ibiza",
  "Mykonos",
  ...ELITE_MARKETS,
]);

export const DEFAULT_CAMPAIGN_REGIONS = [
  "Pakistan",
  "Brazil",
  "Spain",
  "Greece",
  "UAE",
  "Monaco",
  "Italy",
  "Qatar",
  "Saudi Arabia",
  "United States",
  "United Kingdom",
  "Singapore",
] as const;

export const DEFAULT_CAMPAIGN_SIZES = ["SMB", "LARGE"] as const;

export const DEFAULT_NEED_CRITERIA =
  "modern website, software, AI automation, latest technology";

export type CompanySize = "SMB" | "LARGE";

function uniquePreserve(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

/** Stored on Campaign.filters. targetCount / maxLeadsPerDay are ceilings, never quotas. */
export type CampaignIntent = {
  geo?: string;
  /** Country / market labels (e.g. Pakistan, Brazil). */
  regions?: string[];
  /** City focus (e.g. Karachi, São Paulo, Goiânia). */
  cities?: string[];
  companySizes?: CompanySize[];
  /** Free-text need criteria for discover + personalize. */
  needCriteria?: string;
  /** Operator target lead count N for this campaign. */
  targetCount?: number;
  verticals?: string[];
  requiredSignals?: string[];
  preferredSignals?: string[];
  excludedIndustries?: string[];
  primaryOffers?: OfferFamily[];
  languages?: string[];
  maxLeadsPerDay?: number;
  minimumScore?: number;
  allowStartups?: boolean;
};

export function defaultCampaignBrief(): CampaignIntent {
  return {
    regions: [...DEFAULT_CAMPAIGN_REGIONS],
    cities: [...DEFAULT_CAMPAIGN_CITIES],
    companySizes: [...DEFAULT_CAMPAIGN_SIZES],
    needCriteria: DEFAULT_NEED_CRITERIA,
    targetCount: 10,
    maxLeadsPerDay: 10,
  };
}

export function parseCampaignIntent(filters: unknown): CampaignIntent {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return {};
  const row = filters as Record<string, unknown>;
  const offers = Array.isArray(row.primaryOffers)
    ? row.primaryOffers.filter((item): item is OfferFamily =>
        typeof item === "string" && (OFFER_FAMILIES as readonly string[]).includes(item),
      )
    : undefined;
  const sizes = Array.isArray(row.companySizes)
    ? row.companySizes.filter((item): item is CompanySize => item === "SMB" || item === "LARGE")
    : undefined;
  return {
    geo: typeof row.geo === "string" ? row.geo : undefined,
    regions: stringList(row.regions),
    cities: stringList(row.cities),
    companySizes: sizes?.length ? sizes : undefined,
    needCriteria: typeof row.needCriteria === "string" ? row.needCriteria.trim() || undefined : undefined,
    targetCount: typeof row.targetCount === "number" && row.targetCount > 0 ? Math.floor(row.targetCount) : undefined,
    verticals: stringList(row.verticals),
    requiredSignals: stringList(row.requiredSignals),
    preferredSignals: stringList(row.preferredSignals),
    excludedIndustries: stringList(row.excludedIndustries),
    primaryOffers: offers,
    languages: stringList(row.languages),
    maxLeadsPerDay: typeof row.maxLeadsPerDay === "number" ? row.maxLeadsPerDay : undefined,
    minimumScore: typeof row.minimumScore === "number" ? row.minimumScore : undefined,
    allowStartups: row.allowStartups === true,
  };
}

/** Cities for discover seeding: brief cities/regions, else Karachi + SP/Goiânia defaults. */
export function resolveCampaignCities(intent: CampaignIntent | null | undefined): string[] {
  if (intent?.cities?.length) return intent.cities;
  if (intent?.geo?.trim()) return [intent.geo.trim()];
  if (intent?.regions?.length) return intent.regions;
  return [...DEFAULT_CAMPAIGN_CITIES];
}

/** Filter geo gate only when brief lists cities/regions/geo; empty brief → world OK. */
export function briefHasGeoConstraint(intent: CampaignIntent | null | undefined): boolean {
  if (!intent) return false;
  return Boolean(intent.cities?.length || intent.regions?.length || intent.geo?.trim());
}

const GEO_ALIASES: Record<string, string[]> = {
  karachi: ["karachi", "pakistan"],
  "são paulo": ["são paulo", "sao paulo", "saopaulo", "brazil", "brasil"],
  "sao paulo": ["são paulo", "sao paulo", "saopaulo", "brazil", "brasil"],
  goiânia: ["goiânia", "goiania", "brazil", "brasil"],
  goiania: ["goiânia", "goiania", "brazil", "brasil"],
  pakistan: ["pakistan", "karachi"],
  brazil: ["brazil", "brasil", "são paulo", "sao paulo", "goiânia", "goiania"],
  brasil: ["brazil", "brasil", "são paulo", "sao paulo", "goiânia", "goiania"],
  ibiza: ["ibiza", "eivissa", "spain", "baleares", "balearic"],
  mykonos: ["mykonos", "mikonos", "greece", "cyclades"],
  dubai: ["dubai", "uae", "united arab emirates"],
  monaco: ["monaco", "monte carlo", "monte-carlo"],
  milan: ["milan", "milano", "italy"],
  doha: ["doha", "qatar"],
  riyadh: ["riyadh", "saudi", "saudi arabia"],
  "las vegas": ["las vegas", "vegas", "nevada"],
  miami: ["miami", "florida"],
  london: ["london", "uk", "united kingdom", "england"],
  singapore: ["singapore"],
};

function normalizeGeoToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function tokensForTarget(target: string): string[] {
  const key = normalizeGeoToken(target);
  const aliases = GEO_ALIASES[key] ?? GEO_ALIASES[target.toLowerCase()];
  return uniqueLower([key, ...(aliases ?? []).map(normalizeGeoToken)]);
}

function uniqueLower(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Lead location matches campaign brief when brief has cities/regions.
 * If brief has no geo constraint → always true (world OK).
 */
export function matchesCampaignGeo(
  location: string | null | undefined,
  intent: CampaignIntent | null | undefined,
  extraText?: string | null,
): boolean {
  if (!briefHasGeoConstraint(intent)) return true;

  const cities = intent?.cities ?? [];
  const regions = intent?.regions ?? [];
  const targets = uniqueLower([
    ...cities.map(normalizeGeoToken),
    ...regions.map(normalizeGeoToken),
    ...(intent?.geo ? [normalizeGeoToken(intent.geo)] : []),
  ]);
  if (!targets.length) return true;

  const blob = normalizeGeoToken([location, extraText].filter(Boolean).join(" "));
  if (!blob) return false;

  for (const target of targets) {
    for (const token of tokensForTarget(target)) {
      if (token.length >= 3 && blob.includes(token)) return true;
    }
  }
  return false;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length ? items : undefined;
}

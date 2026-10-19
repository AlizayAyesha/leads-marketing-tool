/**
 * Business Profile — describes YOUR business and who you want to reach.
 *
 * Every filter in the app (discovery queries, buyer qualification, scoring, drafts)
 * reads from the active profile. Sources, in priority order:
 *   1. Saved in the app (Settings → Business Profile; stored in the BusinessProfile table)
 *   2. `business-profile.json` in the project root (or BUSINESS_PROFILE_PATH)
 *   3. The generic defaults below (seeded on `npm run setup`)
 *
 * This module is pure (no DB / no server-only) so it can be used in tests and scripts.
 */
export type BusinessProfile = {
  /** Your business / sender name used in drafts, e.g. "Acme Studio". */
  businessName: string;
  /** One or two sentences: what you do and for whom. */
  description: string;
  website: string;
  /** Services you sell, e.g. ["website redesign", "booking systems"]. Used in drafts and demand matching. */
  services: string[];
  /** Industries you sell TO. Empty = any industry. */
  targetIndustries: string[];
  /** Cities / regions / countries. Empty = worldwide. */
  targetLocations: string[];
  /** Free text, e.g. "1-50 employees". Used in prompts and discovery query hints. */
  companySize: string;
  /** Buyer roles / titles, e.g. ["founder", "owner", "ceo"]. */
  targetRoles: string[];
  /** Words that signal demand for your services, e.g. ["need a website", "outdated site"]. */
  includeKeywords: string[];
  /** Any lead containing one of these words is excluded, e.g. ["franchise", "government"]. */
  excludeKeywords: string[];
  /** Competitor names or terms to always exclude. */
  competitors: string[];
  /** Exclude marketing / web / digital agencies (usually competitors). */
  excludeAgencies: boolean;
  /** Exclude software / AI / IT companies and individual developers/designers. */
  excludeTechCompanies: boolean;
  /** Exclude recruiters / HR. */
  excludeRecruiters: boolean;
  /** Exclude students, interns, juniors, job seekers. */
  excludeJuniorRoles: boolean;
  /** Require explicit demand evidence before outreach (recommended). */
  requireDemandSignal: boolean;
  /** Booking / meeting link to include in drafts (optional). */
  bookingUrl: string;
};

/** Generic example: a small web & automation studio selling to local non-tech businesses. Edit it! */
export const DEFAULT_BUSINESS_PROFILE: BusinessProfile = {
  businessName: "Your Business",
  description:
    "We build websites, booking systems and simple AI automations for small non-tech businesses.",
  website: "https://example.com",
  services: ["website", "web app", "software", "AI automation", "chatbot", "SEO"],
  targetIndustries: [
    "clinic", "dental", "dentist", "doctor", "hospital", "healthcare", "pharmacy", "restaurant", "cafe",
    "bistro", "hotel", "hospitality", "salon", "spa", "gym", "fitness", "real estate", "realtor",
    "property developer", "construction", "contractor", "plumber", "electrician", "hvac", "lawyer",
    "attorney", "accountant", "retail", "boutique", "shop", "store", "bakery", "barber", "garage",
    "auto repair", "auto shop", "cleaning", "landscaping", "photography studio", "wedding", "event planner",
    "event planning", "logistics", "warehouse", "manufacturing", "factory", "farm", "agriculture",
    "architecture", "interior", "furniture", "fashion", "jewelry", "aviation", "yacht", "charter",
    "family office", "import", "trading", "distributor", "wholesale",
  ],
  targetLocations: [],
  companySize: "1-200 employees",
  targetRoles: [
    "founder", "co-founder", "cofounder", "ceo", "coo", "owner", "proprietor", "entrepreneur",
    "managing director", "md", "general manager", "gm", "principal", "partner", "operator",
    "business owner", "studio owner", "real estate agent", "real estate broker", "realtor",
    "director of operations", "director of sales", "director of marketing", "director of growth",
    "head of operations", "head of sales", "head of marketing", "head of growth", "head of business",
    "head of ecommerce",
  ],
  includeKeywords: [
    "need a website", "looking for a developer", "hiring a developer", "no website", "outdated website",
    "broken website", "redesign", "rebuild", "modernize", "help building", "recommend a developer",
  ],
  excludeKeywords: [],
  competitors: [],
  excludeAgencies: true,
  excludeTechCompanies: true,
  excludeRecruiters: true,
  excludeJuniorRoles: true,
  requireDemandSignal: true,
  bookingUrl: "",
};

const LIST_KEYS = [
  "services", "targetIndustries", "targetLocations", "targetRoles", "includeKeywords", "excludeKeywords", "competitors",
] as const;
const BOOL_KEYS = [
  "excludeAgencies", "excludeTechCompanies", "excludeRecruiters", "excludeJuniorRoles", "requireDemandSignal",
] as const;
const STR_KEYS = ["businessName", "description", "website", "companySize", "bookingUrl"] as const;

function toList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
  return undefined;
}

/** Merge partial / user input onto defaults, tolerating comma- or newline-separated strings. */
export function normalizeBusinessProfile(input: unknown): BusinessProfile {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: BusinessProfile = { ...DEFAULT_BUSINESS_PROFILE };
  for (const key of STR_KEYS) if (typeof src[key] === "string") out[key] = (src[key] as string).trim();
  for (const key of LIST_KEYS) {
    const list = toList(src[key]);
    if (list) out[key] = list;
  }
  for (const key of BOOL_KEYS) {
    if (typeof src[key] === "boolean") out[key] = src[key] as boolean;
    else if (src[key] === "true" || src[key] === "on") out[key] = true;
    else if (src[key] === "false") out[key] = false;
  }
  return out;
}

let active: BusinessProfile = loadProfileFromFile() ?? DEFAULT_BUSINESS_PROFILE;

function loadProfileFromFile(): BusinessProfile | null {
  try {
    if (typeof process === "undefined" || !process.versions?.node) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const file = process.env.BUSINESS_PROFILE_PATH?.trim() || path.join(process.cwd(), "business-profile.json");
    if (!fs.existsSync(file)) return null;
    return normalizeBusinessProfile(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** Synchronous accessor used by filters. Refreshed from the DB by `loadBusinessProfile()` (server). */
export function getBusinessProfile(): BusinessProfile {
  return active;
}

export function setActiveBusinessProfile(profile: Partial<BusinessProfile> | BusinessProfile | null) {
  active = profile ? normalizeBusinessProfile(profile) : loadProfileFromFile() ?? DEFAULT_BUSINESS_PROFILE;
  compiledFor = null;
}

function escapeRe(word: string) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]?");
}

/** Word-boundary regex for a keyword list. Empty list → regex that never matches. */
export function keywordRegex(words: string[]): RegExp {
  const cleaned = words.map((w) => w.trim()).filter(Boolean);
  if (cleaned.length === 0) return /(?!)/;
  return new RegExp(`\\b(${cleaned.map(escapeRe).join("|")})\\b`, "i");
}

type Compiled = {
  roles: RegExp;
  industries: RegExp;
  include: RegExp;
  exclude: RegExp;
  competitors: RegExp;
  locations: RegExp;
};
let compiledFor: BusinessProfile | null = null;
let compiled: Compiled | null = null;

export function compiledProfile(profile: BusinessProfile = getBusinessProfile()): Compiled {
  if (compiled && compiledFor === profile) return compiled;
  compiled = {
    roles: keywordRegex(profile.targetRoles),
    industries: keywordRegex(profile.targetIndustries),
    include: keywordRegex([...profile.includeKeywords, ...profile.services.map((s) => `need ${s}`), ...profile.services.map((s) => `looking for ${s}`)]),
    exclude: keywordRegex(profile.excludeKeywords),
    competitors: keywordRegex(profile.competitors),
    locations: keywordRegex(profile.targetLocations),
  };
  compiledFor = profile;
  return compiled;
}

/** Short ICP summary for prompts. */
export function profilePromptSummary(profile: BusinessProfile = getBusinessProfile()) {
  const list = (items: string[], fallback: string) => (items.length ? items.slice(0, 25).join(", ") : fallback);
  return [
    `Business: ${profile.businessName} (${profile.website})`,
    `What we do: ${profile.description}`,
    `Services: ${list(profile.services, "not specified")}`,
    `Target industries: ${list(profile.targetIndustries, "any")}`,
    `Target locations: ${list(profile.targetLocations, "worldwide")}`,
    `Company size: ${profile.companySize || "any"}`,
    `Buyer roles: ${list(profile.targetRoles, "any decision-maker")}`,
    `Exclude: ${[
      profile.excludeAgencies ? "agencies" : "",
      profile.excludeTechCompanies ? "software/AI/IT companies and developers" : "",
      profile.excludeRecruiters ? "recruiters/HR" : "",
      ...profile.competitors,
      ...profile.excludeKeywords,
    ].filter(Boolean).join(", ") || "nothing"}`,
  ].join("\n");
}

/** Discovery search phrases built from the profile, e.g. "dental clinic in Berlin". */
export function profileDiscoveryQueries(profile: BusinessProfile = getBusinessProfile(), limit = 10): string[] {
  const industries = profile.targetIndustries.length ? profile.targetIndustries : ["small business"];
  const locations = profile.targetLocations.length ? profile.targetLocations : [""];
  const out: string[] = [];
  for (const loc of locations) {
    for (const ind of industries) {
      out.push(loc ? `${ind} in ${loc}` : ind);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

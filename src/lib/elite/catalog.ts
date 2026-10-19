export type EliteSignalId =
  | "private_aviation"
  | "superyacht"
  | "luxury_real_estate"
  | "family_office"
  | "luxury_hospitality"
  | "investment"
  | "premium_healthcare"
  | "luxury_automotive"
  | "luxury_retail"
  | "international"
  | "technology_gap"
  | "growth";

export type EliteEcosystemId = Exclude<EliteSignalId, "international" | "technology_gap" | "growth">;

export type EliteSearchSource = {
  id: string;
  label: string;
  kind: "google_maps" | "public_web" | "keyword_list" | "licensed_api";
};

export const ELITE_LAYER1_SOURCES: EliteSearchSource[] = [
  { id: "maps_website", label: "Google Maps Business Lead + Website Scraper", kind: "google_maps" },
  { id: "maps_email_audit", label: "Google Maps Leads Scraper — Email/Phone/Audit", kind: "google_maps" },
  { id: "keyword_websites", label: "Keyword Website Lists Scraper", kind: "keyword_list" },
  { id: "no_website", label: "Businesses Without Websites Scraper", kind: "google_maps" },
  { id: "maps_no_website", label: "Google Maps No-Website Leads Scraper", kind: "google_maps" },
  { id: "public_websites", label: "Public company websites", kind: "public_web" },
  { id: "licensed_api", label: "Licensed/API sources (PDL, Firecrawl search)", kind: "licensed_api" },
];

export const ELITE_TARGET_ROLES = [
  "Founder",
  "CEO",
  "Managing Director",
  "Owner",
  "Partner",
  "Chief Technology Officer",
  "Chief Marketing Officer",
  "Head of Digital",
  "Director of Operations",
] as const;

export const ELITE_SCORE_BANDS = [
  { min: 80, max: 100, label: "Priority", code: "priority" as const },
  { min: 60, max: 79, label: "Qualified", code: "qualified" as const },
  { min: 40, max: 59, label: "Review", code: "review" as const },
  { min: 0, max: 39, label: "Reject", code: "reject" as const },
];

export type EliteEcosystem = {
  id: EliteEcosystemId;
  label: string;
  icon: string;
  category: string;
  queries: string[];
};

export const ELITE_ECOSYSTEMS: EliteEcosystem[] = [
  {
    id: "private_aviation",
    label: "Private Aviation",
    icon: "✈",
    category: "Private Jet Charter",
    queries: ["private jet charter", "private aviation", "business jet", "air charter"],
  },
  {
    id: "superyacht",
    label: "Superyachts",
    icon: "🛥",
    category: "Yacht Broker / Charter",
    queries: ["yacht broker", "superyacht", "yacht charter", "yacht management"],
  },
  {
    id: "luxury_real_estate",
    label: "Luxury Real Estate",
    icon: "🏙",
    category: "Luxury Real Estate",
    queries: ["luxury real estate", "luxury property", "luxury villa developer", "high-end real estate"],
  },
  {
    id: "family_office",
    label: "Family Offices",
    icon: "💼",
    category: "Family Office",
    queries: ["family office", "multi family office", "wealth office"],
  },
  {
    id: "luxury_hospitality",
    label: "Luxury Hospitality",
    icon: "🏨",
    category: "Luxury Hotel / Hospitality",
    queries: ["luxury hotel", "luxury hospitality", "five star hotel", "private members club"],
  },
  {
    id: "luxury_retail",
    label: "Luxury Retail",
    icon: "💎",
    category: "Luxury Retail",
    queries: ["luxury retail", "haute joaillerie", "designer boutique"],
  },
  {
    id: "investment",
    label: "Investment & Private Equity",
    icon: "📈",
    category: "Investment / Private Equity",
    queries: ["private equity", "investment company", "asset management"],
  },
  {
    id: "luxury_automotive",
    label: "Exotic Automotive",
    icon: "🚘",
    category: "Luxury Automotive",
    queries: ["exotic car dealer", "luxury automotive", "supercar"],
  },
  {
    id: "premium_healthcare",
    label: "Premium Healthcare",
    icon: "🏥",
    category: "Premium Healthcare",
    queries: ["private clinic", "premium healthcare", "aesthetic clinic", "executive health"],
  },
];

export const ELITE_MARKETS = [
  "Dubai",
  "Monaco",
  "Milan",
  "Doha",
  "Riyadh",
  "Las Vegas",
  "Miami",
  "London",
  "Singapore",
  "Ibiza",
  "Mykonos",
] as const;

export const FIRST_ELITE_EXPERIMENT = {
  id: "dubai-aviation-re-yacht",
  market: "Dubai" as const,
  ecosystemIds: ["private_aviation", "luxury_real_estate", "superyacht"] as EliteEcosystemId[],
  cap: 300,
  minTarget: 100,
  pipelinePriorityCap: 15,
};

export function searchTermsFor(market: string, ecosystemIds: EliteEcosystemId[]) {
  return ecosystemIds.flatMap((id) => {
    const eco = ELITE_ECOSYSTEMS.find((item) => item.id === id);
    if (!eco) return [];
    return eco.queries.map((query) => `${market} ${query}`);
  });
}

export function matchLayer1Actor(actor: { actorId: string; displayName: string; category?: string | null }) {
  const hay = `${actor.actorId} ${actor.displayName} ${actor.category ?? ""}`.toLowerCase();
  if (/linkedin|instagram|fiverr|twitter|x\.com/.test(hay)) return null;
  if (/google maps no-website|no[- ]?website leads scraper/.test(hay)) return "maps_no_website";
  if (/businesses without websites/.test(hay)) return "no_website";
  if (/keyword website lists/.test(hay)) return "keyword_websites";
  if (/maps/.test(hay) && /email/.test(hay) && /phone/.test(hay) && /audit/.test(hay)) return "maps_email_audit";
  if (/maps/.test(hay) && /business lead/.test(hay) && /website scraper/.test(hay)) return "maps_website";
  return null;
}

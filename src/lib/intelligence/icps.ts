export const NAMED_ICP_IDS = [
  "private_aviation",
  "luxury_real_estate",
  "family_office_investment",
  "luxury_hospitality",
  "high_value_b2b",
] as const;

export type NamedIcpId = (typeof NAMED_ICP_IDS)[number];

export type NamedIcp = {
  id: NamedIcpId;
  label: string;
  industry: string;
  businessModels: string[];
  targetGeographies: string[];
  buyerRoles: string[];
  painPatterns: string[];
  technologyPatterns: string[];
  buyingTriggers: string[];
  recommendedOffers: string[];
  disqualifiers: string[];
  match: RegExp;
  models: Array<{ id: string; label: string; re: RegExp }>;
};

/** Luxury is a quality signal, not an ICP. */
export const NAMED_ICPS: NamedIcp[] = [
  {
    id: "private_aviation",
    label: "Private Aviation",
    industry: "Private aviation",
    businessModels: [
      "Jet charter",
      "Aircraft management",
      "Jet broker",
      "Jet card",
      "Aviation concierge",
      "FBO",
      "Aviation management",
    ],
    targetGeographies: ["Dubai", "Doha", "Riyadh", "London", "Miami", "Singapore"],
    buyerRoles: ["CEO", "COO", "Founder", "Managing Director", "Head of Operations"],
    painPatterns: ["manual charter inquiry", "generic contact form", "WhatsApp booking", "no CRM"],
    technologyPatterns: ["no booking workflow", "fragmented ops", "weak lead capture"],
    buyingTriggers: ["new route", "fleet expansion", "new base", "hiring ops"],
    recommendedOffers: ["AI lead qualification", "booking workflow", "CRM", "premium website"],
    disqualifiers: ["airline scheduled passenger", "software aviation SaaS vendor"],
    match: /\b(private jet|business jet|air charter|private aviation|jet charter|jet card|fbo\b|aircraft management|aviation concierge)\b/i,
    models: [
      { id: "jet_charter", label: "Jet Charter", re: /\b(jet )?charter\b/i },
      { id: "aircraft_management", label: "Aircraft Management", re: /\baircraft management\b/i },
      { id: "jet_broker", label: "Jet Broker", re: /\bbroker\b/i },
      { id: "fbo", label: "FBO", re: /\bfbo\b/i },
    ],
  },
  {
    id: "luxury_real_estate",
    label: "Luxury Real Estate",
    industry: "Luxury real estate",
    businessModels: ["Luxury developer", "Property advisory", "Branded residences", "High-end brokerage"],
    targetGeographies: ["Dubai", "Riyadh", "London", "Miami", "Milan"],
    buyerRoles: ["CEO", "Founder", "Sales Director", "Managing Director"],
    painPatterns: ["slow lead qualification", "generic landing", "manual follow-up"],
    technologyPatterns: ["ads + weak landing", "no CRM", "outdated site"],
    buyingTriggers: ["new development", "launch", "new market", "hiring sales"],
    recommendedOffers: ["AI sales automation", "landing/CRO", "luxury website", "CRM"],
    disqualifiers: ["mass-market residential portal", "proptech SaaS"],
    match: /\b(luxury (real estate|property|villa|developer)|high[- ]end (property|real estate|broker)|branded residence|off[- ]plan|property developer)\b/i,
    models: [
      { id: "developer", label: "Luxury Developer", re: /\bdeveloper|development|residences\b/i },
      { id: "brokerage", label: "High-end Brokerage", re: /\bbroker|advisory|agency\b/i },
    ],
  },
  {
    id: "family_office_investment",
    label: "Family Office / Investment",
    industry: "Family office and investment",
    businessModels: ["Family office", "Investment firm", "Private equity", "Venture", "Wealth management"],
    targetGeographies: ["London", "Dubai", "Singapore", "Zurich", "New York"],
    buyerRoles: ["Principal", "Partner", "COO", "CEO"],
    painPatterns: ["multi-entity ops", "document-heavy", "manual reporting"],
    technologyPatterns: ["no internal portal", "fragmented dashboards", "knowledge base gap"],
    buyingTriggers: ["hiring ops", "new fund", "expansion", "digital transformation"],
    recommendedOffers: ["internal AI systems", "secure portals", "workflow automation", "dashboards"],
    disqualifiers: ["retail brokerage app", "fintech product company"],
    match: /\b(family office|private equity|venture (firm|capital)|\bpe\b|wealth management|asset management|investment (firm|office|company)|hedge fund)\b/i,
    models: [
      { id: "family_office", label: "Family Office", re: /\bfamily office\b/i },
      { id: "private_equity", label: "Private Equity", re: /\bprivate equity|\bpe\b/i },
      { id: "wealth", label: "Wealth Management", re: /\bwealth|asset management\b/i },
    ],
  },
  {
    id: "luxury_hospitality",
    label: "Luxury Hospitality",
    industry: "Luxury hospitality",
    businessModels: ["Boutique hotel", "Resort", "Hospitality group", "Private resort", "Yacht charter"],
    targetGeographies: ["Dubai", "Muscat", "Maldives", "Milan", "Miami"],
    buyerRoles: ["Managing Director", "GM", "COO", "Owner"],
    painPatterns: ["WhatsApp CS", "no online booking", "multi-property fragmentation"],
    technologyPatterns: ["manual booking", "multiple systems", "no CRM"],
    buyingTriggers: ["new property", "rebrand", "expansion", "hiring ops"],
    recommendedOffers: ["booking/CRM automation", "AI concierge", "website", "operations dashboard"],
    disqualifiers: ["budget motel chain", "hotel SaaS vendor"],
    match:
      /\b(luxury hotel|boutique hotel|five[- ]star|5[- ]star|resort|hospitality group|members? club|yacht (charter|broker|management)|superyacht)\b/i,
    models: [
      { id: "resort", label: "Resort / Hotel", re: /\bhotel|resort|hospitality\b/i },
      { id: "yacht_charter", label: "Yacht Charter", re: /\byacht|superyacht\b/i },
    ],
  },
  {
    id: "high_value_b2b",
    label: "High-Value B2B",
    industry: "High-value B2B operations",
    businessModels: ["Manufacturing", "Logistics", "Aviation supplier", "Construction", "Engineering", "Energy", "Professional services"],
    targetGeographies: ["UAE", "KSA", "UK", "EU", "US"],
    buyerRoles: ["CEO", "COO", "Operations Director", "Managing Director"],
    painPatterns: ["manual intake", "slow follow-up", "spreadsheet ops"],
    technologyPatterns: ["no CRM", "no dashboard", "legacy site"],
    buyingTriggers: ["new branch", "hiring", "digital transformation", "new product"],
    recommendedOffers: ["enterprise software", "internal AI", "automation", "dashboards"],
    disqualifiers: ["software/AI agency", "IT outsourcing vendor pitching the same stack"],
    match:
      /\b(manufactur|logistics|freight|construction|engineering firm|energy (company|group)|industrial|aviation (parts|supplier|mro)|professional services|consultancy)\b/i,
    models: [
      { id: "manufacturing", label: "Manufacturing", re: /\bmanufactur/i },
      { id: "logistics", label: "Logistics", re: /\blogistics|freight\b/i },
      { id: "construction", label: "Construction", re: /\bconstruction|engineering\b/i },
      { id: "energy", label: "Energy", re: /\benergy\b/i },
    ],
  },
];

export type IcpMatch = {
  icp: NamedIcp | null;
  businessModel: string | null;
  confirmed: boolean;
  reason: string;
};

export function matchNamedIcp(hay: string): IcpMatch {
  const text = hay.trim();
  if (!text) return { icp: null, businessModel: null, confirmed: false, reason: "No industry or company text." };
  for (const icp of NAMED_ICPS) {
    if (!icp.match.test(text)) continue;
    const model = icp.models.find((item) => item.re.test(text));
    return {
      icp,
      businessModel: model?.label ?? icp.businessModels[0] ?? icp.label,
      confirmed: true,
      reason: `Matched ICP ${icp.label}.`,
    };
  }
  return { icp: null, businessModel: null, confirmed: false, reason: "No named your business ICP. Luxury alone is not an ICP." };
}

export function icpById(id: NamedIcpId) {
  return NAMED_ICPS.find((item) => item.id === id) ?? null;
}

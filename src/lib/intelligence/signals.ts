export type LeadSignals = {
  website_exists: boolean;
  website_quality: number | null;
  website_quality_band: "unknown" | "poor" | "fair" | "good";
  has_email: boolean;
  has_phone: boolean;
  has_linkedin: boolean;
  social_presence: boolean;
  contact_available: boolean;
  mentions_ai: boolean;
  mentions_automation: boolean;
  mentions_software: boolean;
  mentions_website_need: boolean;
  explicit_request: boolean;
  operational_complexity: boolean;
  keyword_only: boolean;
  thin_record: boolean;
  industry: string | null;
  location: string | null;
  source: string | null;
};

export type SignalInput = {
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  twitterUrl?: string | null;
  industry?: string | null;
  location?: string | null;
  originalPost?: string | null;
  notes?: string | null;
  source?: string | null;
  websiteQuality?: number | null;
  company?: string | null;
  name?: string | null;
};

const REQUEST_RE =
  /\b(need|needs|needed|looking for|seek(ing)?|hire|hiring|want to|we want|please (build|make|help|automate)|rfp|can you (build|automate|replace)|replace our|build us|help us|must have|we require)\b/i;

const OPERATIONAL_RE =
  /\b(spreadsheet|invoice|manual (data|process|workflow|entry)|repetitive|ticket routing|internal tool|inventory|onboarding portal|agentic workflow|existing web app|existing (application|platform)|customer onboarding)\b/i;

export function hasExplicitRequest(text?: string | null) {
  if (!text?.trim()) return false;
  const stripped = text.replace(/\bno(\s+\w+){0,2}\s+(request|need|website|software)\b/gi, " ");
  return REQUEST_RE.test(stripped);
}

export function extractSignals(input: SignalInput): LeadSignals {
  const text = `${input.originalPost ?? ""} ${input.notes ?? ""}`;
  const lower = text.toLowerCase();
  const quality = input.websiteQuality ?? null;
  const mentions_ai = /\bai\b|artificial intelligence|llm|\bgpt\b/.test(lower);
  const mentions_automation = /automat|workflow|zapier|n8n/.test(lower);
  const mentions_software = /\bsoftware\b|\bsaas\b|web app|application/.test(lower);
  const explicit_request = hasExplicitRequest(input.originalPost) || hasExplicitRequest(input.notes);
  const operational_complexity = OPERATIONAL_RE.test(text);
  const keyword_only =
    (mentions_ai || mentions_automation || mentions_software) && !explicit_request && !operational_complexity;
  const thin_record = !input.website && !input.originalPost?.trim();

  return {
    website_exists: Boolean(input.website),
    website_quality: quality,
    website_quality_band:
      quality == null ? "unknown" : quality <= 4 ? "poor" : quality <= 7 ? "fair" : "good",
    has_email: Boolean(input.email),
    has_phone: Boolean(input.phone),
    has_linkedin: Boolean(input.linkedinUrl),
    social_presence: Boolean(input.instagramUrl || input.facebookUrl || input.twitterUrl || input.linkedinUrl),
    contact_available: Boolean(input.email || input.linkedinUrl || input.phone),
    mentions_ai,
    mentions_automation,
    mentions_software,
    mentions_website_need: /website|landing page|rebuild|redesign|wordpress/.test(lower),
    explicit_request,
    operational_complexity,
    keyword_only,
    thin_record,
    industry: input.industry ?? null,
    location: input.location ?? null,
    source: input.source ?? null,
  };
}

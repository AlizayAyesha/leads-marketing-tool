export const LINKEDIN_RESEARCH_STATUSES = [
  "AVAILABLE",
  "UNAVAILABLE",
  "TIMEOUT",
  "AUTH_REQUIRED",
  "RATE_LIMITED",
  "ERROR",
] as const;

export type LinkedInResearchStatus = (typeof LINKEDIN_RESEARCH_STATUSES)[number];

export const LINKEDIN_RESEARCH_UNAVAILABLE = "LINKEDIN_RESEARCH_UNAVAILABLE";
export const LINKEDIN_ADAPTER_ID = "linkedin-research";
export const LINKEDIN_ADAPTER_VERSION = "1.0.0";
export const LINKEDIN_RESEARCH_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

export type LinkedInEvidenceCategory =
  | "profile_url"
  | "display_name"
  | "headline"
  | "current_company"
  | "role_title"
  | "location"
  | "industry"
  | "about"
  | "company_association"
  | "public_signal";

export type LinkedInEvidenceItem = {
  category: LinkedInEvidenceCategory;
  value: string;
  evidence: string;
  sourceUrl: string;
  timestamp: string;
  confidence: "observed" | "inferred" | "unknown";
};

export type LinkedInProfile = {
  profileUrl: string;
  displayName: string | null;
  headline: string | null;
  currentCompany: string | null;
  roleTitle: string | null;
  location: string | null;
  industry: string | null;
  about: string | null;
  companyAssociation: string | null;
  publicSignals: Record<string, unknown>;
};

export type LinkedInResearchResult = {
  status: LinkedInResearchStatus;
  code: string;
  profile: LinkedInProfile | null;
  evidence: LinkedInEvidenceItem[];
  sourceUrl: string | null;
  retrievedAt: string;
  adapter: string;
  adapterVersion: string;
  message?: string;
  cached?: boolean;
};

export function isLinkedInResearchStatus(value: unknown): value is LinkedInResearchStatus {
  return typeof value === "string" && (LINKEDIN_RESEARCH_STATUSES as readonly string[]).includes(value);
}

export function emptyLinkedInProfile(profileUrl: string): LinkedInProfile {
  return {
    profileUrl,
    displayName: null,
    headline: null,
    currentCompany: null,
    roleTitle: null,
    location: null,
    industry: null,
    about: null,
    companyAssociation: null,
    publicSignals: {},
  };
}

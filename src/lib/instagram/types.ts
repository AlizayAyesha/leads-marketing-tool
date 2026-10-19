export const INSTAGRAM_RESEARCH_STATUSES = [
  "AVAILABLE",
  "UNAVAILABLE",
  "TIMEOUT",
  "AUTH_REQUIRED",
  "RATE_LIMITED",
  "ERROR",
] as const;

export type InstagramResearchStatus = (typeof INSTAGRAM_RESEARCH_STATUSES)[number];

export const INSTAGRAM_RESEARCH_UNAVAILABLE = "INSTAGRAM_RESEARCH_UNAVAILABLE";
export const INSTAGRAM_ADAPTER_ID = "instagram-research";
export const INSTAGRAM_ADAPTER_VERSION = "1.0.0";
export const INSTAGRAM_RESEARCH_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

export type InstagramEvidenceCategory =
  | "profile_url"
  | "username"
  | "display_name"
  | "bio"
  | "professional_category"
  | "public_business"
  | "website"
  | "business_contact"
  | "public_signal";

export type InstagramEvidenceItem = {
  category: InstagramEvidenceCategory;
  value: string;
  evidence: string;
  sourceUrl: string;
  timestamp: string;
  confidence: "observed" | "inferred" | "unknown";
};

export type InstagramProfile = {
  profileUrl: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  professionalCategory: string | null;
  publicBusinessInfo: string | null;
  website: string | null;
  businessContact: string | null;
  publicSignals: Record<string, unknown>;
};

export type InstagramResearchResult = {
  status: InstagramResearchStatus;
  code: string;
  profile: InstagramProfile | null;
  evidence: InstagramEvidenceItem[];
  sourceUrl: string | null;
  retrievedAt: string;
  adapter: string;
  adapterVersion: string;
  message?: string;
  cached?: boolean;
};

export function isInstagramResearchStatus(value: unknown): value is InstagramResearchStatus {
  return typeof value === "string" && (INSTAGRAM_RESEARCH_STATUSES as readonly string[]).includes(value);
}

export function emptyInstagramProfile(profileUrl: string): InstagramProfile {
  return {
    profileUrl,
    username: null,
    displayName: null,
    bio: null,
    professionalCategory: null,
    publicBusinessInfo: null,
    website: null,
    businessContact: null,
    publicSignals: {},
  };
}

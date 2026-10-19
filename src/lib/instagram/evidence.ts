import type {
  InstagramEvidenceCategory,
  InstagramEvidenceItem,
  InstagramProfile,
  InstagramResearchResult,
} from "@/lib/instagram/types";
import {
  emptyInstagramProfile,
  INSTAGRAM_ADAPTER_ID,
  INSTAGRAM_ADAPTER_VERSION,
  isInstagramResearchStatus,
} from "@/lib/instagram/types";

const NEED_INFERENCE_RE =
  /\bneeds?\s+(a\s+)?(website|ai|seo|automation|rebrand|rebuild)\b|\bneeds\s+ai\b|\bneeds\s+seo\b/i;

const CATEGORIES: InstagramEvidenceCategory[] = [
  "profile_url",
  "username",
  "display_name",
  "bio",
  "professional_category",
  "public_business",
  "website",
  "business_contact",
  "public_signal",
];

function clean(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

export function isForbiddenNeedInference(text: string) {
  return NEED_INFERENCE_RE.test(text);
}

export function evidenceFromProfile(profile: InstagramProfile, retrievedAt: string): InstagramEvidenceItem[] {
  const items: InstagramEvidenceItem[] = [];
  const push = (category: InstagramEvidenceCategory, value: string | null, evidence: string) => {
    const next = clean(value);
    if (!next) return;
    if (isForbiddenNeedInference(next) || isForbiddenNeedInference(evidence)) return;
    items.push({
      category,
      value: next,
      evidence,
      sourceUrl: profile.profileUrl,
      timestamp: retrievedAt,
      confidence: "observed",
    });
  };

  push("profile_url", profile.profileUrl, `Public Instagram URL: ${profile.profileUrl}`);
  push("username", profile.username, `Username: ${profile.username}`);
  push("display_name", profile.displayName, `Display name: ${profile.displayName}`);
  push("bio", profile.bio, `Bio excerpt: ${profile.bio?.slice(0, 280)}`);
  push("professional_category", profile.professionalCategory, `Professional category: ${profile.professionalCategory}`);
  push("public_business", profile.publicBusinessInfo, `Public business information: ${profile.publicBusinessInfo}`);
  push("website", profile.website, `Website on profile: ${profile.website}`);
  push("business_contact", profile.businessContact, `Business/contact information: ${profile.businessContact}`);
  return items;
}

export function sanitizeInstagramResearchResult(
  raw: unknown,
  requestedUrl: string,
  retrievedAt = new Date().toISOString(),
): InstagramResearchResult {
  const value =
    raw && typeof raw === "object"
      ? (raw as Partial<InstagramResearchResult> & { profile?: Partial<InstagramProfile> | null })
      : {};
  const status = isInstagramResearchStatus(value.status) ? value.status : "ERROR";
  const code = typeof value.code === "string" && value.code.trim() ? value.code.trim() : "MALFORMED_RESPONSE";
  const sourceUrl = typeof value.sourceUrl === "string" && value.sourceUrl.trim() ? value.sourceUrl.trim() : requestedUrl;
  const profile =
    status === "AVAILABLE" && value.profile && typeof value.profile === "object"
      ? {
          ...emptyInstagramProfile(sourceUrl),
          profileUrl: clean(value.profile.profileUrl) ?? sourceUrl,
          username: clean(value.profile.username),
          displayName: clean(value.profile.displayName),
          bio: clean(value.profile.bio),
          professionalCategory: clean(value.profile.professionalCategory),
          publicBusinessInfo: clean(value.profile.publicBusinessInfo),
          website: clean(value.profile.website),
          businessContact: clean(value.profile.businessContact),
          publicSignals:
            value.profile.publicSignals && typeof value.profile.publicSignals === "object" && !Array.isArray(value.profile.publicSignals)
              ? value.profile.publicSignals
              : {},
        }
      : null;
  const evidence =
    status === "AVAILABLE" && profile
      ? (Array.isArray(value.evidence) ? value.evidence : evidenceFromProfile(profile, retrievedAt))
          .filter(isInstagramEvidenceItem)
          .filter((item) => !isForbiddenNeedInference(item.value) && !isForbiddenNeedInference(item.evidence))
      : [];

  return {
    status,
    code: status === "AVAILABLE" && evidence.length === 0 && code === "MALFORMED_RESPONSE" ? "NO_EVIDENCE" : code,
    profile: status === "AVAILABLE" ? profile : null,
    evidence,
    sourceUrl,
    retrievedAt: typeof value.retrievedAt === "string" ? value.retrievedAt : retrievedAt,
    adapter: typeof value.adapter === "string" ? value.adapter : INSTAGRAM_ADAPTER_ID,
    adapterVersion: typeof value.adapterVersion === "string" ? value.adapterVersion : INSTAGRAM_ADAPTER_VERSION,
    message: typeof value.message === "string" ? value.message : undefined,
    cached: value.cached === true,
  };
}

export function isInstagramEvidenceItem(value: unknown): value is InstagramEvidenceItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<InstagramEvidenceItem>;
  return (
    typeof item.category === "string" &&
    CATEGORIES.includes(item.category as InstagramEvidenceCategory) &&
    typeof item.value === "string" &&
    item.value.trim().length > 0 &&
    typeof item.evidence === "string" &&
    item.evidence.trim().length > 0 &&
    typeof item.sourceUrl === "string" &&
    item.sourceUrl.trim().length > 0 &&
    typeof item.timestamp === "string" &&
    (item.confidence === "observed" || item.confidence === "inferred" || item.confidence === "unknown")
  );
}

export function instagramResearchToAuditPayload(result: {
  status?: string | null;
  bio?: string | null;
  professionalCategory?: string | null;
  publicBusinessInfo?: string | null;
  website?: string | null;
  publicSignals?: unknown;
} | null) {
  if (!result || result.status !== "AVAILABLE") return null;
  const signals =
    result.publicSignals && typeof result.publicSignals === "object" && !Array.isArray(result.publicSignals)
      ? (result.publicSignals as Record<string, unknown>)
      : {};
  const payload: Record<string, unknown> = { ...signals };
  if (result.bio) {
    payload.biography = result.bio;
    payload.bio = result.bio;
  }
  if (result.professionalCategory) {
    payload.businessCategoryName = result.professionalCategory;
    payload.category = result.professionalCategory;
  }
  if (result.publicBusinessInfo) payload.publicBusinessInfo = result.publicBusinessInfo;
  if (result.website) payload.website = result.website;
  return payload;
}

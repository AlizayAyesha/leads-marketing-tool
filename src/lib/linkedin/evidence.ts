import type {
  LinkedInEvidenceCategory,
  LinkedInEvidenceItem,
  LinkedInProfile,
  LinkedInResearchResult,
} from "@/lib/linkedin/types";
import { emptyLinkedInProfile, isLinkedInResearchStatus, LINKEDIN_ADAPTER_ID, LINKEDIN_ADAPTER_VERSION } from "@/lib/linkedin/types";

const NEED_INFERENCE_RE =
  /\bneeds?\s+(a\s+)?(website|ai|seo|automation|rebrand|rebuild)\b|\bneeds\s+ai\b|\bneeds\s+seo\b/i;

const CATEGORIES: LinkedInEvidenceCategory[] = [
  "profile_url",
  "display_name",
  "headline",
  "current_company",
  "role_title",
  "location",
  "industry",
  "about",
  "company_association",
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

export function evidenceFromProfile(profile: LinkedInProfile, retrievedAt: string): LinkedInEvidenceItem[] {
  const items: LinkedInEvidenceItem[] = [];
  const push = (category: LinkedInEvidenceCategory, value: string | null, evidence: string) => {
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

  push("profile_url", profile.profileUrl, `Public LinkedIn URL: ${profile.profileUrl}`);
  push("display_name", profile.displayName, `Display name: ${profile.displayName}`);
  push("headline", profile.headline, `Headline: ${profile.headline}`);
  push("current_company", profile.currentCompany, `Current company: ${profile.currentCompany}`);
  push("role_title", profile.roleTitle, `Role/title: ${profile.roleTitle}`);
  push("location", profile.location, `Location: ${profile.location}`);
  push("industry", profile.industry, `Industry: ${profile.industry}`);
  push("about", profile.about, `About/summary excerpt: ${profile.about?.slice(0, 280)}`);
  push("company_association", profile.companyAssociation, `Company association: ${profile.companyAssociation}`);
  return items;
}

export function sanitizeLinkedInResearchResult(
  raw: unknown,
  requestedUrl: string,
  retrievedAt = new Date().toISOString(),
): LinkedInResearchResult {
  const value = raw && typeof raw === "object" ? (raw as Partial<LinkedInResearchResult> & { profile?: Partial<LinkedInProfile> | null }) : {};
  const status = isLinkedInResearchStatus(value.status) ? value.status : "ERROR";
  const code = typeof value.code === "string" && value.code.trim() ? value.code.trim() : "MALFORMED_RESPONSE";
  const sourceUrl = typeof value.sourceUrl === "string" && value.sourceUrl.trim() ? value.sourceUrl.trim() : requestedUrl;
  const profile =
    status === "AVAILABLE" && value.profile && typeof value.profile === "object"
      ? {
          ...emptyLinkedInProfile(sourceUrl),
          profileUrl: clean(value.profile.profileUrl) ?? sourceUrl,
          displayName: clean(value.profile.displayName),
          headline: clean(value.profile.headline),
          currentCompany: clean(value.profile.currentCompany),
          roleTitle: clean(value.profile.roleTitle),
          location: clean(value.profile.location),
          industry: clean(value.profile.industry),
          about: clean(value.profile.about),
          companyAssociation: clean(value.profile.companyAssociation),
          publicSignals:
            value.profile.publicSignals && typeof value.profile.publicSignals === "object" && !Array.isArray(value.profile.publicSignals)
              ? value.profile.publicSignals
              : {},
        }
      : null;
  const evidence =
    status === "AVAILABLE" && profile
      ? (Array.isArray(value.evidence) ? value.evidence : evidenceFromProfile(profile, retrievedAt))
          .filter(isLinkedInEvidenceItem)
          .filter((item) => !isForbiddenNeedInference(item.value) && !isForbiddenNeedInference(item.evidence))
      : [];

  return {
    status: status === "AVAILABLE" && evidence.length === 0 ? "AVAILABLE" : status,
    code: status === "AVAILABLE" && evidence.length === 0 && code === "MALFORMED_RESPONSE" ? "NO_EVIDENCE" : code,
    profile: status === "AVAILABLE" ? profile : null,
    evidence,
    sourceUrl,
    retrievedAt: typeof value.retrievedAt === "string" ? value.retrievedAt : retrievedAt,
    adapter: typeof value.adapter === "string" ? value.adapter : LINKEDIN_ADAPTER_ID,
    adapterVersion: typeof value.adapterVersion === "string" ? value.adapterVersion : LINKEDIN_ADAPTER_VERSION,
    message: typeof value.message === "string" ? value.message : undefined,
    cached: value.cached === true,
  };
}

export function isLinkedInEvidenceItem(value: unknown): value is LinkedInEvidenceItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LinkedInEvidenceItem>;
  return (
    typeof item.category === "string" &&
    CATEGORIES.includes(item.category as LinkedInEvidenceCategory) &&
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

export function linkedinResearchToAuditPayload(result: {
  status?: string | null;
  headline?: string | null;
  about?: string | null;
  roleTitle?: string | null;
  currentCompany?: string | null;
  publicSignals?: unknown;
} | null) {
  if (!result || result.status !== "AVAILABLE") return null;
  const signals =
    result.publicSignals && typeof result.publicSignals === "object" && !Array.isArray(result.publicSignals)
      ? (result.publicSignals as Record<string, unknown>)
      : {};
  const payload: Record<string, unknown> = { ...signals };
  if (result.headline) payload.headline = result.headline;
  if (result.about) payload.about = result.about;
  if (result.roleTitle) payload.occupation = result.roleTitle;
  if (result.currentCompany) payload.company = result.currentCompany;
  return payload;
}

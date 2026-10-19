import { LinkedInResearchError, type LinkedInResearchProvider } from "@/lib/linkedin/provider";
import { sanitizeLinkedInResearchResult } from "@/lib/linkedin/evidence";
import {
  LINKEDIN_ADAPTER_ID,
  LINKEDIN_ADAPTER_VERSION,
  type LinkedInResearchResult,
  type LinkedInResearchStatus,
} from "@/lib/linkedin/types";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";

export async function queryLinkedInResearch(input: {
  profileUrl?: string | null;
  provider: LinkedInResearchProvider;
}): Promise<LinkedInResearchResult> {
  const inspected = inspectLinkedInUrl(input.profileUrl);
  const requested = input.profileUrl?.trim() || "";
  if (inspected.kind === "missing") {
    return result("UNAVAILABLE", "LINKEDIN_URL_MISSING", "No LinkedIn URL is stored on the lead.", requested);
  }
  if (inspected.kind === "invalid" || inspected.kind === "wrong_host") {
    return result(
      "ERROR",
      "INVALID_LINKEDIN_URL",
      inspected.kind === "wrong_host"
        ? `URL host is ${inspected.host}, not LinkedIn.`
        : "LinkedIn URL could not be parsed.",
      requested,
    );
  }
  if (inspected.kind === "not_profile" || inspected.kind === "linkedin_other" || inspected.kind === "school") {
    return result(
      "ERROR",
      "INVALID_LINKEDIN_URL",
      "Stored LinkedIn value is not a person or company profile URL.",
      requested,
    );
  }

  const normalizedUrl = inspected.normalizedUrl!;
  try {
    const fetched = await input.provider.fetchProfile({ profileUrl: requested, normalizedUrl });
    return sanitizeLinkedInResearchResult(fetched, normalizedUrl);
  } catch (error) {
    return mapProviderError(error, normalizedUrl);
  }
}

function result(
  status: LinkedInResearchStatus,
  code: string,
  message: string,
  sourceUrl: string,
): LinkedInResearchResult {
  return {
    status,
    code,
    profile: null,
    evidence: [],
    sourceUrl: sourceUrl || null,
    retrievedAt: new Date().toISOString(),
    adapter: LINKEDIN_ADAPTER_ID,
    adapterVersion: LINKEDIN_ADAPTER_VERSION,
    message,
  };
}

function mapProviderError(error: unknown, sourceUrl: string): LinkedInResearchResult {
  if (error instanceof LinkedInResearchError) {
    return result(error.status, error.code, error.message, sourceUrl);
  }
  const message = error instanceof Error ? error.message : "LinkedIn research failed.";
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || /timed? ?out/i.test(message)) {
    return result("TIMEOUT", "TIMEOUT", message, sourceUrl);
  }
  if (/\b401\b|\b403\b|unauthorized|auth required/i.test(message)) {
    return result("AUTH_REQUIRED", "AUTH_REQUIRED", message, sourceUrl);
  }
  if (/\b429\b|rate limit/i.test(message)) {
    return result("RATE_LIMITED", "RATE_LIMITED", message, sourceUrl);
  }
  return result("ERROR", "ERROR", message, sourceUrl);
}

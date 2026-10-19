import { InstagramResearchError, type InstagramResearchProvider } from "@/lib/instagram/provider";
import { sanitizeInstagramResearchResult } from "@/lib/instagram/evidence";
import {
  INSTAGRAM_ADAPTER_ID,
  INSTAGRAM_ADAPTER_VERSION,
  type InstagramResearchResult,
  type InstagramResearchStatus,
} from "@/lib/instagram/types";
import { inspectInstagramUrl } from "@/lib/instagram/url";

export async function queryInstagramResearch(input: {
  profileUrl?: string | null;
  provider: InstagramResearchProvider;
}): Promise<InstagramResearchResult> {
  const inspected = inspectInstagramUrl(input.profileUrl);
  const requested = input.profileUrl?.trim() || "";
  if (inspected.kind === "missing") {
    return result("UNAVAILABLE", "INSTAGRAM_URL_MISSING", "No Instagram URL is stored on the lead.", requested);
  }
  if (inspected.kind === "invalid" || inspected.kind === "wrong_host") {
    return result(
      "ERROR",
      "INVALID_INSTAGRAM_URL",
      inspected.kind === "wrong_host"
        ? `URL host is ${inspected.host}, not Instagram.`
        : "Instagram URL could not be parsed.",
      requested,
    );
  }
  if (inspected.kind === "not_profile") {
    return result(
      "ERROR",
      "INVALID_INSTAGRAM_URL",
      "Stored Instagram value is not a profile URL.",
      requested,
    );
  }

  const normalizedUrl = inspected.normalizedUrl!;
  try {
    const fetched = await input.provider.fetchProfile({ profileUrl: requested, normalizedUrl });
    return sanitizeInstagramResearchResult(fetched, normalizedUrl);
  } catch (error) {
    return mapProviderError(error, normalizedUrl);
  }
}

function result(
  status: InstagramResearchStatus,
  code: string,
  message: string,
  sourceUrl: string,
): InstagramResearchResult {
  return {
    status,
    code,
    profile: null,
    evidence: [],
    sourceUrl: sourceUrl || null,
    retrievedAt: new Date().toISOString(),
    adapter: INSTAGRAM_ADAPTER_ID,
    adapterVersion: INSTAGRAM_ADAPTER_VERSION,
    message,
  };
}

function mapProviderError(error: unknown, sourceUrl: string): InstagramResearchResult {
  if (error instanceof InstagramResearchError) {
    return result(error.status, error.code, error.message, sourceUrl);
  }
  const message = error instanceof Error ? error.message : "Instagram research failed.";
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

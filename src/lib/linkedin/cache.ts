import { LINKEDIN_RESEARCH_FRESHNESS_MS } from "@/lib/linkedin/types";

export function linkedinResearchIsFresh(
  retrievedAt: Date | string | null | undefined,
  now = new Date(),
  windowMs = LINKEDIN_RESEARCH_FRESHNESS_MS,
) {
  if (!retrievedAt) return false;
  const at = retrievedAt instanceof Date ? retrievedAt : new Date(retrievedAt);
  if (Number.isNaN(at.getTime())) return false;
  return now.getTime() - at.getTime() <= windowMs;
}

export function shouldReuseLinkedInResearch(input: {
  forceRefresh?: boolean;
  retrievedAt?: Date | string | null;
  normalizedUrl?: string | null;
  requestedNormalizedUrl?: string | null;
  now?: Date;
}) {
  if (input.forceRefresh) return false;
  if (!input.normalizedUrl || !input.requestedNormalizedUrl) return false;
  if (input.normalizedUrl !== input.requestedNormalizedUrl) return false;
  return linkedinResearchIsFresh(input.retrievedAt, input.now);
}

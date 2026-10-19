import { INSTAGRAM_RESEARCH_FRESHNESS_MS } from "@/lib/instagram/types";

export function instagramResearchIsFresh(
  retrievedAt: Date | string | null | undefined,
  now = new Date(),
  windowMs = INSTAGRAM_RESEARCH_FRESHNESS_MS,
) {
  if (!retrievedAt) return false;
  const at = retrievedAt instanceof Date ? retrievedAt : new Date(retrievedAt);
  if (Number.isNaN(at.getTime())) return false;
  return now.getTime() - at.getTime() <= windowMs;
}

export function shouldReuseInstagramResearch(input: {
  forceRefresh?: boolean;
  retrievedAt?: Date | string | null;
  normalizedUrl?: string | null;
  requestedNormalizedUrl?: string | null;
  now?: Date;
}) {
  if (input.forceRefresh) return false;
  if (!input.normalizedUrl || !input.requestedNormalizedUrl) return false;
  if (input.normalizedUrl !== input.requestedNormalizedUrl) return false;
  return instagramResearchIsFresh(input.retrievedAt, input.now);
}

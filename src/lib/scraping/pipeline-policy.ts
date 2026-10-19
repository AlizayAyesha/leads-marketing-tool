export function actorAllowedInFullScrape(actor: {
  actorId: string;
  displayName: string;
  category?: string | null;
  platform?: string | null;
}) {
  const hay = `${actor.actorId} ${actor.displayName} ${actor.category ?? ""} ${actor.platform ?? ""}`.toLowerCase();
  if (/linkedin|fiverr|instagram|twitter|tweet-scraper/.test(hay)) return false;
  return true;
}

export function shouldFallbackToConnectedScrapers(input: {
  apifyQuotaHit: boolean;
  apifyLeadsCreated: number;
}) {
  return input.apifyQuotaHit || input.apifyLeadsCreated <= 0;
}

export function shouldRetryScrapeError(message: string) {
  return !/usage hard limit|quota|payment required|unauthorized|invalid token|401|403/i.test(message);
}

/** A succeeded Actor run is never started again. A success statusMessage is not an error. */
export function shouldRetryActorAttempt(input: { status?: string | null; error?: string | null }) {
  if (input.status === "SUCCEEDED") return false;
  if (!input.error) return false;
  return shouldRetryScrapeError(input.error);
}

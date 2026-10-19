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

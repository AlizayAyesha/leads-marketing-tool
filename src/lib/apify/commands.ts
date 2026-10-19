export type ApifyCommandPlan = {
  intent: "RUN_APIFY_ACTORS";
  testMode: boolean;
  pipeline: boolean;
  limit: number;
  actorQuery: string | null;
  opening: string;
};

export function parseApifyCommand(command: string): ApifyCommandPlan | null {
  const text = command.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const mentionsApify = /apify|actor(s)?|scraper|scraping|google maps lead/i.test(lower);
  const wantsRun = /\brun\b|\bimport the results\b|\bcombine their results\b/.test(lower);
  if (!mentionsApify || !wantsRun) return null;
  if (/upwork|fiverr|linkedin send|send email/.test(lower) && !/apify|actor/.test(lower)) return null;

  const testMode = !/\bfull run\b|\bproduction run\b/.test(lower);
  const pipeline = /import|brain|research|qualif|draft|pipeline|lead/i.test(lower);
  const actorQuery = extractActorQuery(text);

  return {
    intent: "RUN_APIFY_ACTORS",
    testMode,
    pipeline: pipeline || /import the results/.test(lower),
    limit: testMode ? 5 : 25,
    actorQuery,
    opening: testMode
      ? "Running configured Apify Actors in test mode (5-result cap). Nothing will be sent."
      : "Running configured Apify Actors. Nothing will be sent until you approve a draft.",
  };
}

function extractActorQuery(command: string) {
  const named = command.match(/run (?:the )?(.+?) actors?\b/i)?.[1]?.trim();
  if (
    named &&
    !/^my lead scraping$/i.test(named) &&
    !/^these(?:\s+\w+)?$/i.test(named) &&
    !/^lead scraping$/i.test(named)
  ) return named;
  return null;
}

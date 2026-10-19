export type ApifyRunInfo = {
  id: string;
  status: string;
  defaultDatasetId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  statusMessage: string | null;
};

export const TEST_RESULT_CAP = 5;
export const FULL_RESULT_CAP = 500;

export const RESULT_CAP_KEYS = [
  "maxItems",
  "maxResults",
  "max_results",
  "max_result",
  "resultsLimit",
  "totalResults",
  "total_results",
  "maxCrawledPlaces",
  "maxCrawledPlacesPerSearch",
  "maxResultsPerQuery",
  "maxRequestsPerCrawl",
  "maxReviews",
] as const;

export function encodeActorId(actorId: string) {
  const trimmed = actorId.trim();
  if (!/^[a-zA-Z0-9_./~-]+$/.test(trimmed)) {
    throw new Error("Actor ID contains invalid characters.");
  }
  return trimmed.replaceAll("/", "~");
}

export function mapApifyStatus(status: string) {
  const value = status.toUpperCase();
  if (value === "READY" || value === "RUNNING") return "RUNNING" as const;
  if (value === "SUCCEEDED") return "SUCCEEDED" as const;
  if (value === "FAILED") return "FAILED" as const;
  if (value === "ABORTED" || value === "ABORTING") return "ABORTED" as const;
  if (value === "TIMED-OUT" || value === "TIMED_OUT") return "TIMED_OUT" as const;
  return "RUNNING" as const;
}

export function applyResultCap(
  input: Record<string, unknown>,
  schema: Record<string, unknown> | null,
  testMode: boolean,
) {
  const cap = testMode ? TEST_RESULT_CAP : FULL_RESULT_CAP;
  const next = { ...input };
  const properties = schemaProperties(schema);
  for (const key of RESULT_CAP_KEYS) {
    if (key in next || key in properties) {
      const current = Number(next[key]);
      next[key] = Number.isFinite(current) ? Math.min(current, cap) : cap;
    }
  }
  const pageKeys = ["max_pages", "maxPages"];
  if (testMode) {
    for (const key of pageKeys) {
      if (key in next || key in properties) next[key] = 1;
    }
  }
  if (
    testMode &&
    !RESULT_CAP_KEYS.some((key) => key in next) &&
    !pageKeys.some((key) => key in next || key in properties)
  ) {
    next.maxItems = cap;
  }
  return next;
}

function schemaProperties(schema: Record<string, unknown> | null) {
  return schema && typeof schema.properties === "object" && schema.properties
    ? (schema.properties as Record<string, unknown>)
    : {};
}

export function testModeBlockedBySchema(schema: Record<string, unknown> | null) {
  const properties = schemaProperties(schema);
  for (const key of RESULT_CAP_KEYS) {
    const def = properties[key];
    if (!def || typeof def !== "object" || Array.isArray(def)) continue;
    const minimum = Number((def as { minimum?: unknown }).minimum);
    if (Number.isFinite(minimum) && minimum > TEST_RESULT_CAP) {
      return `TEST is capped at ${TEST_RESULT_CAP} results. This Actor requires ${key} >= ${minimum}. Refusing to run ${minimum} as a test.`;
    }
  }
  return null;
}

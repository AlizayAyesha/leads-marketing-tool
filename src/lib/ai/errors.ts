export type OpenAIErrorCategory =
  | "INVALID_API_KEY"
  | "AUTHENTICATION_ERROR"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "BAD_REQUEST"
  | "CONTEXT_LENGTH_ERROR"
  | "MODEL_NOT_FOUND"
  | "PERMISSION_ERROR"
  | "UNKNOWN";

export function classifyOpenAIError(error: unknown): OpenAIErrorCategory {
  const status =
    typeof error === "object" && error && "status" in error
      ? Number((error as { status?: number }).status)
      : undefined;
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error);
  const text = `${code} ${message}`.toLowerCase();

  if (status === 401 || /invalid api key|incorrect api key|authentication/i.test(text)) {
    return /invalid api key|incorrect api key/i.test(text) ? "INVALID_API_KEY" : "AUTHENTICATION_ERROR";
  }
  if (status === 429 || /rate limit|too many requests/i.test(text)) return "RATE_LIMITED";
  if (status === 403 || /permission|forbidden/i.test(text)) return "PERMISSION_ERROR";
  if (status === 404 || /model.?not.?found|does not exist/i.test(text)) return "MODEL_NOT_FOUND";
  if (/context length|maximum context|token limit/i.test(text)) return "CONTEXT_LENGTH_ERROR";
  if (status === 400 || /bad request|invalid_request/i.test(text)) return "BAD_REQUEST";
  if (
    /fetch failed|econnreset|enotfound|etimedout|network|socket/i.test(text) ||
    status === 0
  ) {
    return "NETWORK_ERROR";
  }
  return "UNKNOWN";
}

export function mayFailover(category: OpenAIErrorCategory) {
  return category === "RATE_LIMITED" || category === "INVALID_API_KEY" || category === "AUTHENTICATION_ERROR";
}

export function marksCredentialUnhealthy(category: OpenAIErrorCategory) {
  return category === "INVALID_API_KEY" || category === "AUTHENTICATION_ERROR";
}

export function isTransientRateLimit(category: OpenAIErrorCategory) {
  return category === "RATE_LIMITED";
}

function headerValue(error: unknown, name: string) {
  if (!error || typeof error !== "object" || !("headers" in error)) return null;
  const headers = (error as { headers?: { get?: (key: string) => string | null } & Record<string, string> }).headers;
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name) ?? headers.get(name.toLowerCase());
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

export function retryAfterMs(error: unknown, fallback = 60_000) {
  const raw = headerValue(error, "retry-after") ?? headerValue(error, "Retry-After");
  if (!raw) return fallback;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return fallback;
  return Math.min(Math.max(seconds * 1000, 1_000), 15 * 60_000);
}

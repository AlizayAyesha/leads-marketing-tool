const SECRET_KEYS = /cookie|password|passwd|authorization|set-cookie|session[_-]?token|api[_-]?key|secret|refresh[_-]?token|access[_-]?token/i;

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.test(key) ? "[REDACTED]" : redactSecrets(item);
    }
    return out;
  }
  return value;
}

export function redactText(text: string) {
  return text
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(/(?:cookie|authorization|password|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]")
    .replace(/[A-Za-z0-9+/]{24,}={0,2}/g, (token) => (token.length > 40 ? "[REDACTED]" : token));
}

export function domainFromUrl(url?: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

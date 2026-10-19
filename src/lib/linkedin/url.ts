export type LinkedInUrlKind =
  | "missing"
  | "invalid"
  | "wrong_host"
  | "person"
  | "company"
  | "school"
  | "not_profile"
  | "linkedin_other";

export type LinkedInUrlInspection = {
  kind: LinkedInUrlKind;
  host: string | null;
  path: string;
  normalizedUrl: string | null;
};

function parseUrl(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

export function extractLinkedInPublicIdentifier(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    const match = parsed.pathname.match(/\/in\/([^/]+)/i);
    if (!match?.[1]) return null;
    return decodeURIComponent(match[1]).replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function inspectLinkedInUrl(value?: string | null): LinkedInUrlInspection {
  const raw = value?.trim();
  if (!raw) {
    return { kind: "missing", host: null, path: "", normalizedUrl: null };
  }
  const parsed = parseUrl(raw);
  if (!parsed) {
    return { kind: "invalid", host: null, path: "", normalizedUrl: null };
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) {
    return { kind: "wrong_host", host, path: parsed.pathname, normalizedUrl: null };
  }
  const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  const kind: LinkedInUrlKind = /^\/in\/[^/]+/.test(path)
    ? "person"
    : /^\/company\/[^/]+/.test(path)
      ? "company"
      : /^\/school\/[^/]+/.test(path)
        ? "school"
        : /^\/(search|feed|jobs|login|signup)/.test(path) || path === "" || path === "/"
          ? "not_profile"
          : "linkedin_other";
  const slug = path.split("/").filter(Boolean);
  const canonicalPath =
    kind === "person" || kind === "company" || kind === "school"
      ? `/${slug.slice(0, 2).join("/")}`
      : path;
  const normalizedUrl =
    kind === "person" || kind === "company" || kind === "school"
      ? `https://www.linkedin.com${canonicalPath}`
      : null;
  return { kind, host, path, normalizedUrl };
}

export function normalizeLinkedInProfileUrl(value?: string | null) {
  const inspected = inspectLinkedInUrl(value);
  return inspected.normalizedUrl;
}

export function isResearchableLinkedInUrl(value?: string | null) {
  const kind = inspectLinkedInUrl(value).kind;
  return kind === "person" || kind === "company";
}

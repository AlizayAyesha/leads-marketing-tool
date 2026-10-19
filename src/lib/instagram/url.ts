export type InstagramUrlKind = "missing" | "invalid" | "wrong_host" | "profile" | "not_profile";

export type InstagramUrlInspection = {
  kind: InstagramUrlKind;
  host: string | null;
  path: string;
  username: string | null;
  normalizedUrl: string | null;
};

const RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "stories",
  "explore",
  "accounts",
  "tv",
  "tags",
  "directory",
  "about",
  "legal",
  "developer",
  "graphql",
  "direct",
]);

function parseUrl(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

export function extractInstagramUsername(value?: string | null) {
  return inspectInstagramUrl(value).username;
}

export function inspectInstagramUrl(value?: string | null): InstagramUrlInspection {
  const raw = value?.trim();
  if (!raw) {
    return { kind: "missing", host: null, path: "", username: null, normalizedUrl: null };
  }
  const parsed = parseUrl(raw);
  if (!parsed) {
    return { kind: "invalid", host: null, path: "", username: null, normalizedUrl: null };
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "instagram.com" && !host.endsWith(".instagram.com")) {
    return { kind: "wrong_host", host, path: parsed.pathname, username: null, normalizedUrl: null };
  }
  const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  const segments = path.split("/").filter(Boolean);
  const first = segments[0] ?? "";
  if (!first || RESERVED.has(first)) {
    return { kind: "not_profile", host, path, username: null, normalizedUrl: null };
  }
  const username = first.replace(/^@/, "");
  if (!/^[a-z0-9._]{1,30}$/i.test(username)) {
    return { kind: "not_profile", host, path, username: null, normalizedUrl: null };
  }
  return {
    kind: "profile",
    host,
    path,
    username,
    normalizedUrl: `https://www.instagram.com/${username}`,
  };
}

export function normalizeInstagramProfileUrl(value?: string | null) {
  return inspectInstagramUrl(value).normalizedUrl;
}

export function isResearchableInstagramUrl(value?: string | null) {
  return inspectInstagramUrl(value).kind === "profile";
}

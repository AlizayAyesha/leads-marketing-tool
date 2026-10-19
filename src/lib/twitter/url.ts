/** Normalize public X / Twitter profile URLs. */

export type TwitterUrlInspect = {
  kind: "person" | "status" | "other" | "invalid";
  handle: string | null;
  url: string | null;
  statusId: string | null;
};

export function normalizeTwitterHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(trimmed)) return null;
  return trimmed;
}

export function profileUrlFromHandle(handle: string | null | undefined): string | null {
  const normalized = normalizeTwitterHandle(handle);
  return normalized ? `https://x.com/${normalized}` : null;
}

export function inspectTwitterUrl(raw: string | null | undefined): TwitterUrlInspect {
  if (!raw?.trim()) return { kind: "invalid", handle: null, url: null, statusId: null };
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw.trim() : `https://${raw.trim()}`;
    const parsed = new URL(withScheme);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "x.com" && host !== "twitter.com" && !host.endsWith(".twitter.com")) {
      return { kind: "invalid", handle: null, url: null, statusId: null };
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (!parts.length) return { kind: "other", handle: null, url: null, statusId: null };

    const first = parts[0].toLowerCase();
    if (["i", "home", "explore", "search", "intent", "share", "hashtag"].includes(first)) {
      return { kind: "other", handle: null, url: null, statusId: null };
    }

    const handle = normalizeTwitterHandle(parts[0]);
    if (!handle) return { kind: "invalid", handle: null, url: null, statusId: null };

    if (parts[1]?.toLowerCase() === "status" && parts[2]) {
      return {
        kind: "status",
        handle,
        url: profileUrlFromHandle(handle),
        statusId: parts[2].replace(/\D/g, "") || parts[2],
      };
    }

    return {
      kind: "person",
      handle,
      url: profileUrlFromHandle(handle),
      statusId: null,
    };
  } catch {
    return { kind: "invalid", handle: null, url: null, statusId: null };
  }
}

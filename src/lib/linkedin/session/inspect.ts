import type { LinkedInConnectionProviderResult } from "@/lib/linkedin/connection/types";

export type LinkedInProfileUiState = "AUTH_REQUIRED" | "CONNECTED" | "REQUESTED" | "NOT_REQUESTED" | "UNKNOWN";

export type LinkedInProfileButtons = {
  connect: boolean;
  pending: boolean;
  message: boolean;
  follow?: boolean;
};

export type LinkedInProfileInspection = {
  state: LinkedInProfileUiState;
  code: string;
  reason: string;
  firstDegree: boolean;
  rateLimited: boolean;
};

const AUTH_WALL_RE =
  /\/login|\/signup|authwall|checkpoint|join linkedin|sign up \| linkedin|agree & join|sign in to linkedin/i;
const FIRST_DEGREE_RE = /\b1st(\s+degree)?(\s+connection)?\b/i;
const RATE_LIMIT_RE = /weekly invitation limit|too many invitations|you.?ve reached the (weekly|daily)/i;

export function isLinkedInAuthWall(url?: string | null, title?: string | null, text?: string | null) {
  const urlTitle = `${url ?? ""}\n${title ?? ""}`;
  // URL/title are authoritative. Body text alone can false-positive on feed promos ("Join LinkedIn").
  if (AUTH_WALL_RE.test(urlTitle)) return true;
  if (/linkedin\.com\/(feed|in\/|messaging)\b/i.test(url ?? "") && /linkedin/i.test(title ?? "")) {
    return false;
  }
  return AUTH_WALL_RE.test(text ?? "");
}

export function isLinkedInRateLimited(text?: string | null) {
  return RATE_LIMIT_RE.test(text ?? "");
}

export function inspectLinkedInProfileUi(input: {
  url?: string | null;
  title?: string | null;
  text?: string | null;
  buttons: LinkedInProfileButtons;
}): LinkedInProfileInspection {
  const text = input.text ?? "";
  // Page-wide "1st" is informational only — sidebars mention 1st for other people.
  const pageMentions1st = FIRST_DEGREE_RE.test(text);
  const rateLimited = isLinkedInRateLimited(text);
  const follow = Boolean(input.buttons.follow);
  if (isLinkedInAuthWall(input.url, input.title, text)) {
    return {
      state: "AUTH_REQUIRED",
      code: "AUTH_REQUIRED",
      reason: "LinkedIn login wall. Sign into LinkedIn in the connected Jarvis Chrome session.",
      firstDegree: false,
      rateLimited,
    };
  }
  if (input.buttons.pending) {
    return {
      state: "REQUESTED",
      code: "PENDING",
      reason: "LinkedIn shows Pending. REQUESTED is not CONNECTED.",
      firstDegree: pageMentions1st,
      rateLimited,
    };
  }
  // A Connect control on this profile is the sendable truth. Do not skip it because
  // "1st" appears on another card or in page chrome.
  if (input.buttons.connect) {
    return {
      state: "NOT_REQUESTED",
      code: "NOT_REQUESTED",
      reason: "Connect is still available. Not connected.",
      firstDegree: false,
      rateLimited,
    };
  }
  // Follow means not a first-degree connection — never CONNECTED from page text alone.
  if (follow) {
    return {
      state: "UNKNOWN",
      code: "UNKNOWN",
      reason:
        "Follow is visible on this profile. Not treated as connected; Connect may still be under More.",
      firstDegree: false,
      rateLimited,
    };
  }
  // Strong action signal: can Message, cannot Connect/Pending/Follow → already connected.
  if (input.buttons.message && !input.buttons.connect && !input.buttons.pending && !follow) {
    return {
      state: "CONNECTED",
      code: "CONNECTED",
      reason: "Message is available without Connect, Pending, or Follow — treated as first-degree.",
      firstDegree: true,
      rateLimited,
    };
  }
  return {
    state: "UNKNOWN",
    code: "UNKNOWN",
    reason: "LinkedIn UI did not confirm Connect, Pending, Message-only, or Follow. UNKNOWN is not CONNECTED.",
    firstDegree: pageMentions1st,
    rateLimited,
  };
}

export function mapUiStateToProviderResult(state: LinkedInProfileUiState): LinkedInConnectionProviderResult {
  if (state === "CONNECTED") return "CONNECTED";
  if (state === "REQUESTED") return "PENDING";
  return "UNKNOWN";
}

export async function inspectLinkedInPage(
  page: {
    url(): string;
    title(): Promise<string>;
    innerText(): Promise<string>;
    hasVisibleButton(name: RegExp): Promise<boolean>;
    readTopCardActions?: () => Promise<{
      connect: boolean;
      pending: boolean;
      message: boolean;
      follow?: boolean;
      more?: boolean;
    }>;
  },
): Promise<LinkedInProfileInspection & { url: string; title: string; text: string; buttons: LinkedInProfileButtons }> {
  const [title, text, top] = await Promise.all([
    page.title().catch(() => ""),
    page.innerText().catch(() => ""),
    page.readTopCardActions ? page.readTopCardActions().catch(() => null) : Promise.resolve(null),
  ]);
  let buttons: LinkedInProfileButtons;
  if (top) {
    buttons = {
      connect: top.connect,
      pending: top.pending,
      message: top.message,
      follow: top.follow,
    };
  } else {
    const [connect, invite, pending, message, follow] = await Promise.all([
      page.hasVisibleButton(/^(Connect|Invite)$/i),
      page.hasVisibleButton(/Invite .+ to connect/i),
      page.hasVisibleButton(/^Pending$/i),
      page.hasVisibleButton(/^Message\b/i),
      page.hasVisibleButton(/^Follow$/i),
    ]);
    buttons = {
      connect: connect || invite,
      pending,
      message,
      follow,
    };
  }
  const inspected = inspectLinkedInProfileUi({ url: page.url(), title, text, buttons });
  return { ...inspected, url: page.url(), title, text, buttons };
}

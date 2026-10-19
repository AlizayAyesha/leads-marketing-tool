import type { TwitterBrowserPage } from "@/lib/browser/twitter-page";
import {
  TWITTER_FOLLOWING_BUTTON,
  TWITTER_FOLLOW_BUTTON,
  clickTwitterDmButton,
  clickTwitterProfileButton,
  hasTwitterDmButton,
  hasTwitterProfileButton,
} from "@/lib/browser/twitter-page";

export type TwitterPageState =
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "CAN_MESSAGE"
  | "NEEDS_FOLLOW"
  | "DM_NOT_ALLOWED"
  | "UNKNOWN";

export type TwitterProfileInspection = {
  state: TwitterPageState;
  code: string;
  reason: string;
  buttons: {
    message: boolean;
    follow: boolean;
    following: boolean;
  };
};

const TWITTER_AUTH_WALL_RE =
  /\/i\/flow\/login|\/login|\/signup|sign in to x|log in to x|login on x\.com|to continue to x|don't miss what's happening|create your account/i;

export function isTwitterAuthWall(url?: string | null, title?: string | null, text?: string | null) {
  const urlTitle = `${url ?? ""}\n${title ?? ""}`;
  if (TWITTER_AUTH_WALL_RE.test(urlTitle)) return true;
  if (/x\.com\/(home|messages|notifications|compose)\b/i.test(url ?? "")) return false;
  return TWITTER_AUTH_WALL_RE.test(text ?? "");
}

export function isTwitterAuthenticated(url?: string | null, title?: string | null, text?: string | null) {
  if (isTwitterAuthWall(url, title, text)) return false;
  if (/x\.com\/(home|messages|notifications|compose)\b/i.test(url ?? "")) return true;
  if (/home\s*\/\s*x/i.test(title ?? "")) return true;
  return false;
}

export async function inspectTwitterPage(page: TwitterBrowserPage): Promise<TwitterProfileInspection> {
  const text = (await page.innerText().catch(() => "")).toLowerCase();
  const url = page.url().toLowerCase();
  const title = (await page.title().catch(() => "")).toLowerCase();

  if (isTwitterAuthWall(url, title, text)) {
    return {
      state: "AUTH_REQUIRED",
      code: "AUTH_REQUIRED",
      reason: "Jarvis Chrome is not signed into X. Sign in at x.com in the Jarvis window.",
      buttons: { message: false, follow: false, following: false },
    };
  }

  if (/rate limit|try again later|something went wrong|temporarily restricted|automated behavior/.test(text)) {
    return {
      state: "RATE_LIMITED",
      code: "RATE_LIMITED",
      reason: "X appears rate-limited or restricted. Stop sending for today.",
      buttons: { message: false, follow: false, following: false },
    };
  }

  const message = await hasTwitterDmButton(page);
  const follow = await hasTwitterProfileButton(page, TWITTER_FOLLOW_BUTTON);
  const following = await hasTwitterProfileButton(page, TWITTER_FOLLOWING_BUTTON);

  if (message) {
    return {
      state: "CAN_MESSAGE",
      code: "CAN_MESSAGE",
      reason: "Message control is available.",
      buttons: { message, follow, following },
    };
  }

  if (follow && !following) {
    return {
      state: "NEEDS_FOLLOW",
      code: "NEEDS_FOLLOW",
      reason: "Message is not available yet. Follow once, then re-check Message.",
      buttons: { message, follow, following },
    };
  }

  if (/these posts are protected|account is private|doesn't accept message requests|can't message this account/i.test(text)) {
    return {
      state: "DM_NOT_ALLOWED",
      code: "DM_NOT_ALLOWED",
      reason: "This account does not allow DMs from Jarvis's X session.",
      buttons: { message, follow, following },
    };
  }

  return {
    state: "DM_NOT_ALLOWED",
    code: "DM_NOT_ALLOWED",
    reason: "No Message control visible. Fail closed — nothing was sent.",
    buttons: { message, follow, following },
  };
}

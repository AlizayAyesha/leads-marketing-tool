import type { LinkedInSessionHost } from "@/lib/linkedin/session/host";
import { chromeLinkedInSessionHost } from "@/lib/linkedin/session/host";
import { inspectLinkedInPage, type LinkedInProfileUiState } from "@/lib/linkedin/session/inspect";

export const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";

export type OpenLinkedInFeedResult =
  | {
      ok: false;
      code: "DISCONNECTED";
      signedIn: false;
      url: null;
      title: null;
      state: null;
      message: string;
    }
  | {
      ok: true;
      code: string;
      signedIn: boolean;
      url: string;
      title: string;
      state: LinkedInProfileUiState;
      message: string;
    };

export async function openLinkedInFeed(
  host: LinkedInSessionHost = chromeLinkedInSessionHost(),
): Promise<OpenLinkedInFeedResult> {
  if (!host.connected()) {
    return {
      ok: false,
      code: "DISCONNECTED",
      signedIn: false,
      url: null,
      title: null,
      state: null,
      message: "Jarvis Chrome is DISCONNECTED. Click Connect first.",
    };
  }

  return host.runOnPage(async (page) => {
    // Playwright starts on about:blank — always navigate to LinkedIn (retry once).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await page.goto(LINKEDIN_FEED_URL);
        if (!/about:blank/i.test(page.url())) break;
      } catch {
        if (attempt === 1) {
          return {
            ok: true as const,
            code: "NAVIGATION_FAILED",
            signedIn: false,
            url: page.url(),
            title: (await page.title().catch(() => "")) || "",
            state: "AUTH_REQUIRED" as LinkedInProfileUiState,
            message: "LinkedIn did not load (still blank). Click Open LinkedIn again.",
          };
        }
      }
    }
    const inspected = await inspectLinkedInPage(page);
    const signedIn = inspected.state !== "AUTH_REQUIRED";
    const stillBlank = /about:blank/i.test(inspected.url);
    return {
      ok: true as const,
      code: inspected.code,
      signedIn,
      url: inspected.url,
      title: inspected.title,
      state: inspected.state,
      message: stillBlank
        ? "Jarvis Chrome opened a blank page. Click Open LinkedIn again."
        : signedIn
          ? `LinkedIn is open in Jarvis Chrome${inspected.title ? ` (${inspected.title})` : ""}.`
          : "LinkedIn login is open in this Chrome window. Sign in there, then click Open LinkedIn again.",
    };
  });
}

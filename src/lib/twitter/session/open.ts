import { chromeTwitterSessionHost, type TwitterSessionHost } from "@/lib/twitter/session/host";
import { inspectTwitterPage } from "@/lib/twitter/session/inspect";

export const TWITTER_HOME_URL = "https://x.com/home";

export async function openTwitterHome(host: TwitterSessionHost = chromeTwitterSessionHost()) {
  if (!host.connected()) {
    return {
      ok: false as const,
      signedIn: false,
      url: null as string | null,
      message: "Jarvis Chrome is DISCONNECTED. Connect it first.",
    };
  }

  return host.runOnPage(async (page) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await page.goto(TWITTER_HOME_URL);
        if (!/about:blank/i.test(page.url())) break;
      } catch {
        if (attempt === 1) {
          return {
            ok: false as const,
            signedIn: false,
            url: page.url(),
            message: "X did not load (still blank). Click Open X again.",
          };
        }
      }
    }
    const inspected = await inspectTwitterPage(page);
    const signedIn = inspected.state !== "AUTH_REQUIRED";
    return {
      ok: true as const,
      signedIn,
      url: page.url(),
      message: signedIn
        ? "X is open in Jarvis Chrome."
        : "X login is open in this Chrome window. Sign in there, then click Open X again.",
    };
  });
}

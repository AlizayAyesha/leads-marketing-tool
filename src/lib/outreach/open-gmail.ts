import { getChromeDriver, getChromeSession, noteChromeNavigation } from "@/lib/tools/chrome";

export const GMAIL_INBOX_URL = "https://mail.google.com/mail/u/0/#inbox";

export async function openGmailInbox() {
  if (getChromeSession().status !== "CONNECTED") {
    return {
      ok: false as const,
      signedIn: false,
      url: null as string | null,
      message: "Jarvis Chrome is DISCONNECTED. Connect it first.",
    };
  }
  const driver = getChromeDriver();
  if (!driver?.connected() || !driver.runOnPage) {
    return {
      ok: false as const,
      signedIn: false,
      url: null as string | null,
      message: "Jarvis Chrome is DISCONNECTED. Connect it first.",
    };
  }

  const opened = await driver.runOnPage(async (page) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await page.goto(GMAIL_INBOX_URL);
        if (!/about:blank/i.test(page.url())) break;
      } catch {
        if (attempt === 1) {
          return {
            ok: false as const,
            signedIn: false,
            url: page.url(),
            message: "Gmail did not load. Click Open Gmail again.",
          };
        }
      }
    }
    const url = page.url();
    const title = (await page.title().catch(() => "")) || "";
    const signedIn = /mail\.google\.com/i.test(url) && !/accounts\.google\.com|ServiceLogin/i.test(url);
    return {
      ok: true as const,
      signedIn,
      url,
      message: signedIn
        ? `Gmail is open in Jarvis Chrome${title ? ` (${title})` : ""}.`
        : "Google login is open in this Chrome window. Sign into Gmail there, then click Open Gmail again.",
    };
  });
  noteChromeNavigation(opened.url, opened.ok ? null : opened.message);
  return opened;
}

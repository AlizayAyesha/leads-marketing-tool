import type { TwitterBrowserPage } from "@/lib/browser/twitter-page";
import { getChromeDriver, getChromeSession } from "@/lib/tools/chrome";

export type TwitterSessionHost = {
  connected(): boolean;
  runOnPage<T>(fn: (page: TwitterBrowserPage) => Promise<T>): Promise<T>;
};

export function isChromeTwitterSessionReady() {
  const session = getChromeSession();
  const driver = getChromeDriver();
  return session.status === "CONNECTED" && Boolean(driver?.connected() && typeof driver.runOnPage === "function");
}

export function chromeTwitterSessionHost(): TwitterSessionHost {
  return {
    connected: () => isChromeTwitterSessionReady(),
    runOnPage: async (fn) => {
      const driver = getChromeDriver();
      if (!driver?.connected() || !driver.runOnPage) {
        throw new Error("Jarvis Chrome is DISCONNECTED. Connect it from Integrations → Chrome, then sign into x.com.");
      }
      // Driver wraps Playwright as LinkedInBrowserPage; the click/fill APIs are generic enough for X.
      return driver.runOnPage((page) => fn(page as TwitterBrowserPage));
    },
  };
}

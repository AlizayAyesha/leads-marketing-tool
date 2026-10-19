import type { LinkedInBrowserPage } from "@/lib/browser/linkedin-page";
import { getChromeDriver, getChromeSession } from "@/lib/tools/chrome";

export type LinkedInSessionHost = {
  connected(): boolean;
  runOnPage<T>(fn: (page: LinkedInBrowserPage) => Promise<T>): Promise<T>;
};

export function isChromeLinkedInSessionReady() {
  const session = getChromeSession();
  const driver = getChromeDriver();
  return session.status === "CONNECTED" && Boolean(driver?.connected() && typeof driver.runOnPage === "function");
}

export function chromeLinkedInSessionHost(): LinkedInSessionHost {
  return {
    connected: () => isChromeLinkedInSessionReady(),
    runOnPage: async (fn) => {
      const driver = getChromeDriver();
      if (!driver?.connected() || !driver.runOnPage) {
        throw new Error("Jarvis Chrome is DISCONNECTED. Connect it from Integrations → Chrome, then sign into LinkedIn.");
      }
      return driver.runOnPage(fn);
    },
  };
}

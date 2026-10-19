import "server-only";

import { ChromeDisconnectedError } from "@/lib/browser/driver";
import { connectChrome, disconnectChrome, getChromeSession } from "@/lib/tools/chrome";

export type BrowserAgentCapability =
  | "open_public_profile"
  | "research_page"
  | "prepare_outreach"
  | "crm_update"
  | "permitted_public_listing_research"
  | "navigate"
  | "sheets"
  | "files"
  | "forms";

export interface BrowserAgentProvider {
  readonly id: string;
  readonly configured: boolean;
  connect(): Promise<{ ok: true; session: ReturnType<typeof getChromeSession> }>;
  disconnect(): Promise<ReturnType<typeof getChromeSession>>;
  capabilities(): BrowserAgentCapability[];
  status(): ReturnType<typeof getChromeSession>;
}

export class JarvisChromeProvider implements BrowserAgentProvider {
  readonly id = "jarvis-chrome";

  get configured() {
    return getChromeSession().status === "CONNECTED";
  }

  capabilities(): BrowserAgentCapability[] {
    return [
      "navigate",
      "research_page",
      "open_public_profile",
      "sheets",
      "files",
      "forms",
      "prepare_outreach",
      "crm_update",
      "permitted_public_listing_research",
    ];
  }

  status() {
    return getChromeSession();
  }

  async connect() {
    const session = await connectChrome();
    return { ok: true as const, session };
  }

  async disconnect() {
    return disconnectChrome();
  }
}

export function getBrowserAgentProvider(): BrowserAgentProvider {
  return new JarvisChromeProvider();
}

export { ChromeDisconnectedError };

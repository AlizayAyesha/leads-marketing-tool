import type { LinkedInBrowserPage } from "@/lib/browser/linkedin-page";
import type { BrowserCommand, BrowserEvidence } from "@/lib/browser/types";

export interface ChromeDriver {
  readonly id: string;
  connected(): boolean;
  connect(): Promise<{ sessionId: string; profile?: string }>;
  disconnect(): Promise<void>;
  perform(command: BrowserCommand): Promise<BrowserEvidence>;
  runOnPage?<T>(fn: (page: LinkedInBrowserPage) => Promise<T>): Promise<T>;
}

export class ChromeDisconnectedError extends Error {
  constructor(detail = "Jarvis Chrome is DISCONNECTED. Connect it from Integrations → Chrome.") {
    super(detail);
    this.name = "ChromeDisconnectedError";
  }
}

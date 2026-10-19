import type { ChromeDriver } from "@/lib/browser/driver";
import { ChromeDisconnectedError } from "@/lib/browser/driver";
import type { BrowserCommand, BrowserEvidence } from "@/lib/browser/types";

export class MockChromeDriver implements ChromeDriver {
  readonly id = "mock-chrome";
  private open = false;
  sessionId = "mock-session";
  lastCommand: BrowserCommand | null = null;
  failNext: string | null = null;
  pages: BrowserEvidence = {
    url: "https://fixture.example.test/",
    title: "Fixture page",
    textExcerpt: "Public fixture content. No secrets.",
    tables: [
      ["company", "website", "email"],
      ["Northwind Ops Fixture", "https://fixture.example.test/northwind-ops", "priya@northwind-ops.fixture"],
    ],
    links: [{ href: "https://fixture.example.test/northwind-ops", text: "Northwind" }],
    screenshotNote: "screenshot:captured",
  };

  connected() {
    return this.open;
  }

  async connect() {
    this.open = true;
    return { sessionId: this.sessionId };
  }

  async disconnect() {
    this.open = false;
  }

  async perform(command: BrowserCommand): Promise<BrowserEvidence> {
    this.lastCommand = command;
    if (!this.open) throw new ChromeDisconnectedError();
    if (this.failNext) {
      const message = this.failNext;
      this.failNext = null;
      throw new Error(message);
    }
    if (command.action === "message_send") {
      return {
        url: command.url ?? this.pages.url,
        title: this.pages.title,
        textExcerpt: "Send control was clicked. Delivery evidence: message appeared in sent folder.",
        screenshotNote: "screenshot:send-succeeded",
      };
    }
    return {
      ...this.pages,
      url: command.url ?? this.pages.url,
      title: command.action === "sheet_read" ? "Google Sheets fixture" : this.pages.title,
    };
  }
}

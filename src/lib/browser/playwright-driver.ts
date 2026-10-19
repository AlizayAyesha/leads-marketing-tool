import { mkdir } from "node:fs/promises";
import path from "node:path";

import { ChromeDisconnectedError, type ChromeDriver } from "@/lib/browser/driver";
import { isSameNavTarget, wrapPlaywrightPage } from "@/lib/browser/linkedin-page";
import type { LinkedInBrowserPage } from "@/lib/browser/linkedin-page";
import {
  releaseJarvisChromeProfile,
  shouldReleaseJarvisChromeProfile,
} from "@/lib/browser/jarvis-chrome-lock";
import { JARVIS_CURSOR_INIT_SCRIPT } from "@/lib/browser/visible-cursor";
import { saveChromeTarget } from "@/lib/browser/profiles";
import { jarvisPlaywrightLaunchOptions, JARVIS_CHROME_PROFILE_DIR } from "@/lib/browser/jarvis-chrome-launch";
import type { BrowserCommand, BrowserEvidence } from "@/lib/browser/types";

const JARVIS_PROFILE_DIR = JARVIS_CHROME_PROFILE_DIR;
const LINKEDIN_START_URL = "https://www.linkedin.com/feed/";

type PlaywrightPage = {
  url: () => string;
  title: () => Promise<string>;
  goto: (url: string, opts?: object) => Promise<unknown>;
  goBack: () => Promise<unknown>;
  goForward: () => Promise<unknown>;
  reload: () => Promise<unknown>;
  click: (selector: string) => Promise<unknown>;
  fill: (selector: string, value: string) => Promise<unknown>;
  hover: (selector: string) => Promise<unknown>;
  keyboard: { press: (key: string) => Promise<unknown> };
  mouse: { wheel: (x: number, y: number) => Promise<unknown> };
  content: () => Promise<string>;
};

type PlaywrightContext = {
  addInitScript: (script: string) => Promise<unknown>;
  pages: () => PlaywrightPage[];
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
};

type PlaywrightModule = {
  chromium: {
    launchPersistentContext: (userDataDir: string, options: Record<string, unknown>) => Promise<PlaywrightContext>;
  };
};

/**
 * Google Chrome 136+ ignores --remote-debugging-port on the everyday
 * user-data-dir. Jarvis therefore never attaches to the operator's personal Chrome.
 * It opens a separate persistent window under .jarvis/chrome-profile.
 */
export class PlaywrightChromeDriver implements ChromeDriver {
  readonly id = "playwright-chrome";
  private context: PlaywrightContext | null = null;
  private sessionId: string | null = null;
  private profileLabel = "Jarvis Chrome";

  connected() {
    return Boolean(this.context);
  }

  async connect() {
    await this.disconnect();
    const playwright = await loadPlaywright();
    this.profileLabel = "Jarvis Chrome";
    saveChromeTarget({
      mode: "jarvis",
      profileDirectory: null,
      displayName: this.profileLabel,
    });
    await mkdir(JARVIS_PROFILE_DIR, { recursive: true });
    try {
      this.context = await this.launchContext(playwright);
    } catch (error) {
      if (shouldReleaseJarvisChromeProfile(error)) {
        await releaseJarvisChromeProfile(JARVIS_PROFILE_DIR);
        try {
          this.context = await this.launchContext(playwright);
        } catch (retryError) {
          this.context = null;
          throw this.toConnectError(retryError);
        }
      } else {
        this.context = null;
        throw this.toConnectError(error);
      }
    }
    // One persistent overlay for every document in this context (survives navigations).
    await this.context.addInitScript(JARVIS_CURSOR_INIT_SCRIPT).catch(() => undefined);
      // Playwright always opens about:blank first — navigate away immediately.
      const page = this.context.pages()[0] ?? (await this.context.newPage());
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await page.goto(LINKEDIN_START_URL, { waitUntil: "commit", timeout: 30_000 });
          if (!/about:blank/i.test(page.url())) break;
        } catch {
          // Leave the window open; Open LinkedIn / Connect retry will navigate.
        }
      }
    this.sessionId = `chrome-${Date.now().toString(36)}`;
    return { sessionId: this.sessionId, profile: this.profileLabel };
  }

  async disconnect() {
    await this.context?.close().catch(() => undefined);
    this.context = null;
    this.sessionId = null;
    // Next.js hot-reload / crash can leave an orphan Chrome holding the profile.
    await releaseJarvisChromeProfile(JARVIS_PROFILE_DIR).catch(() => undefined);
  }

  private async launchContext(playwright: PlaywrightModule) {
    const opts = jarvisPlaywrightLaunchOptions(JARVIS_PROFILE_DIR);
    const { userDataDir, ...launchOpts } = opts;
    return playwright.chromium.launchPersistentContext(userDataDir, launchOpts);
  }

  private toConnectError(error: unknown) {
    const detail = error instanceof Error ? error.message : "Chrome failed to start";
    return new ChromeDisconnectedError(
      `Could not open Jarvis Chrome (${detail}). Close any other Jarvis Chrome window, then Connect again. Leave your everyday Google Chrome open.`,
    );
  }

  async runOnPage<T>(fn: (page: LinkedInBrowserPage) => Promise<T>): Promise<T> {
    if (!this.context) throw new ChromeDisconnectedError();
    const page = this.context.pages()[0] ?? (await this.context.newPage());
    return fn(wrapPlaywrightPage(page));
  }

  async perform(command: BrowserCommand): Promise<BrowserEvidence> {
    if (!this.context) throw new ChromeDisconnectedError();
    const page = this.context.pages()[0] ?? (await this.context.newPage());

    if (command.action === "navigate" && command.url && !isSameNavTarget(page.url(), command.url)) {
      await page.goto(command.url, { waitUntil: "domcontentloaded" });
    }
    if (command.action === "back") await page.goBack();
    if (command.action === "forward") await page.goForward();
    if (command.action === "reload") await page.reload();
    if (command.action === "click" && command.selector) await page.click(command.selector);
    if ((command.action === "type" || command.action === "form_fill" || command.action === "message_prepare") && command.selector && command.text) {
      await page.fill(command.selector, command.text);
    }
    if (command.action === "hover" && command.selector) await page.hover(command.selector);
    if (command.action === "keyboard" && command.text) await page.keyboard.press(command.text);
    if (command.action === "scroll") await page.mouse.wheel(0, 600);

    const html = await page.content();
    const excerpt = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);

    return {
      url: page.url(),
      title: await page.title(),
      textExcerpt: excerpt,
      screenshotNote: "screenshot:available-in-session",
    };
  }
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return (await import("playwright")) as unknown as PlaywrightModule;
  } catch {
    throw new ChromeDisconnectedError(
      "Playwright is not installed. Run npm install playwright && npx playwright install chrome, then Connect again.",
    );
  }
}

export function chromeProfileDir() {
  return JARVIS_PROFILE_DIR;
}

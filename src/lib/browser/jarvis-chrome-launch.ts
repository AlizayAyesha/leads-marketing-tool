import { spawn } from "node:child_process";
import path from "node:path";

import { chromeExecutable } from "@/lib/browser/profiles";

export const JARVIS_CHROME_PROFILE_DIR = path.join(process.cwd(), ".jarvis", "chrome-profile");

export const JARVIS_WINDOW_SIZE = { width: 1360, height: 900 } as const;

/** Playwright defaults (automation + mock keychain) often block X/Google login. */
export function jarvisPlaywrightLaunchOptions(userDataDir = JARVIS_CHROME_PROFILE_DIR) {
  return {
    channel: "chrome",
    headless: false,
    // viewport:null = no Playwright device-metrics emulation, so the window is never
    // re-sized/re-emulated per page. Window size is fixed once via --window-size.
    viewport: null,
    ignoreDefaultArgs: ["--enable-automation", "--use-mock-keychain"],
    args: [
      "--disable-blink-features=AutomationControlled",
      `--window-size=${JARVIS_WINDOW_SIZE.width},${JARVIS_WINDOW_SIZE.height}`,
      "--window-position=40,40",
    ],
    // slowMo delays EVERY mouse.move; the cursor animation sends ~60 moves per glide,
    // so 140ms made it crawl at ~7fps. Pacing now comes from the cursor itself.
    slowMo: 0,
    userDataDir,
  };
}

/**
 * Open real Chrome on the Jarvis profile — no Playwright automation flags.
 * Use this when the operator needs to sign into X or Google OAuth.
 */
export function openJarvisChromeManually(url: string, userDataDir = JARVIS_CHROME_PROFILE_DIR) {
  const executable = chromeExecutable();
  const child = spawn(
    executable,
    [`--user-data-dir=${path.resolve(userDataDir)}`, "--no-first-run", "--no-default-browser-check", url],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  return { pid: child.pid ?? null, profileDir: userDataDir, url };
}

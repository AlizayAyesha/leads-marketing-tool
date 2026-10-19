import { existsSync } from "node:fs";

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function chromeExecutablePath() {
  const fromEnv = process.env.PLAYWRIGHT_CHROME_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync(MAC_CHROME)) return MAC_CHROME;
  return null;
}

/** Launch installed Chrome. Bundled Chromium is unsupported on macOS 12. */
export function playwrightLaunchOptions() {
  const executablePath = chromeExecutablePath();
  const channel = process.env.PLAYWRIGHT_CHANNEL?.trim();
  if (executablePath) {
    return {
      headless: true,
      executablePath,
      args: ["--disable-dev-shm-usage", "--disable-gpu"],
    };
  }
  if (channel) {
    return {
      headless: true,
      channel,
      args: ["--disable-dev-shm-usage", "--disable-gpu"],
    };
  }
  return { headless: true, args: ["--disable-dev-shm-usage", "--disable-gpu"] };
}

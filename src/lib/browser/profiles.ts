import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ChromeProfileChoice = {
  id: string;
  mode: "jarvis" | "system";
  directory: string | null;
  displayName: string;
  emailHint: string | null;
};

export type ChromeTarget = {
  mode: "jarvis" | "system";
  profileDirectory: string | null;
  displayName: string;
};

const TARGET_PATH = path.join(process.cwd(), ".jarvis", "chrome-target.json");

export function maskEmail(email: string) {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at < 1) return null;
  return `${trimmed.slice(0, 1)}••••@${trimmed.slice(at + 1)}`;
}

export function parseChromeInfoCache(cache: Record<string, Record<string, unknown>>): ChromeProfileChoice[] {
  return Object.entries(cache).map(([directory, info]) => {
    const displayName = String(info.gaia_name || info.name || directory);
    const email = String(info.user_name || "");
    return {
      id: `system:${directory}`,
      mode: "system" as const,
      directory,
      displayName,
      emailHint: maskEmail(email),
    };
  });
}

export function chromeUserDataDir() {
  return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
}

export function chromeExecutable() {
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

export function listChromeProfiles(): ChromeProfileChoice[] {
  const jarvis: ChromeProfileChoice = {
    id: "jarvis",
    mode: "jarvis",
    directory: null,
    displayName: "Blank Jarvis Chrome",
    emailHint: null,
  };
  const localState = path.join(chromeUserDataDir(), "Local State");
  if (!existsSync(localState)) return [jarvis];
  try {
    const raw = JSON.parse(readFileSync(localState, "utf8")) as {
      profile?: { info_cache?: Record<string, Record<string, unknown>> };
    };
    const cache = raw.profile?.info_cache ?? {};
    const system = parseChromeInfoCache(cache).sort((a, b) => {
      if (a.directory === "Default") return -1;
      if (b.directory === "Default") return 1;
      return a.displayName.localeCompare(b.displayName);
    });
    return [...system, jarvis];
  } catch {
    return [jarvis];
  }
}

export function defaultChromeTarget(profiles = listChromeProfiles()): ChromeTarget {
  const jarvis = profiles.find((item) => item.mode === "jarvis");
  return {
    mode: "jarvis",
    profileDirectory: null,
    displayName: jarvis?.displayName ?? "Jarvis Chrome",
  };
}

export function readChromeTarget(): ChromeTarget {
  if (!existsSync(TARGET_PATH)) return defaultChromeTarget();
  try {
    const raw = JSON.parse(readFileSync(TARGET_PATH, "utf8")) as Partial<ChromeTarget>;
    if (raw.mode !== "jarvis" && raw.mode !== "system") return defaultChromeTarget();
    return {
      mode: raw.mode,
      profileDirectory: raw.profileDirectory ?? null,
      displayName: raw.displayName || (raw.mode === "jarvis" ? "Jarvis Chrome" : "Chrome"),
    };
  } catch {
    return defaultChromeTarget();
  }
}

export function saveChromeTarget(target: ChromeTarget) {
  mkdirSync(path.dirname(TARGET_PATH), { recursive: true });
  writeFileSync(TARGET_PATH, `${JSON.stringify(target, null, 2)}\n`);
  return target;
}

export function chromeTargetPath() {
  return TARGET_PATH;
}

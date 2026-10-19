import { spawnSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import path from "node:path";

const SINGLETON_NAMES = ["SingletonLock", "SingletonCookie", "SingletonSocket"] as const;

function isProfileInUseError(detail: string) {
  return /existing browser session|profile is already in use|SingletonLock/i.test(detail);
}

/** PIDs whose argv includes the Jarvis profile user-data-dir (never everyday Chrome). */
export function listJarvisChromePids(profileDir: string): number[] {
  const marker = path.resolve(profileDir);
  const result = spawnSync("pgrep", ["-f", marker], { encoding: "utf8" });
  if (result.status !== 0 && result.status !== 1) return [];
  return (result.stdout || "")
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function clearSingletonFiles(profileDir: string) {
  await Promise.all(
    SINGLETON_NAMES.map((name) => unlink(path.join(profileDir, name)).catch(() => undefined)),
  );
}

function signalPids(pids: number[], signal: NodeJS.Signals) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone or not permitted
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * When Next.js restarts, Playwright loses its handle but Chrome keeps the
 * .jarvis/chrome-profile lock. Kill only those processes and clear singleton files.
 */
export async function releaseJarvisChromeProfile(profileDir: string): Promise<void> {
  const resolved = path.resolve(profileDir);
  const pids = listJarvisChromePids(resolved);
  if (pids.length) {
    signalPids(pids, "SIGTERM");
    await sleep(800);
    const remaining = listJarvisChromePids(resolved);
    if (remaining.length) {
      signalPids(remaining, "SIGKILL");
      await sleep(400);
    }
  }
  await clearSingletonFiles(resolved);
}

export function shouldReleaseJarvisChromeProfile(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return isProfileInUseError(detail);
}

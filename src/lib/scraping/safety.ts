import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import type { ScrapingInput } from "@/lib/scraping/types";

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

function privateIp(host: string) {
  if (!isIP(host)) return false;
  return /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
}

export function validateScrapingUrl(raw: string, allowedDomains: string[] = []) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only public HTTP(S) URLs are allowed.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host) || privateIp(host) || host.endsWith(".local")) throw new Error("Private or local network targets are blocked.");
  if (allowedDomains.length && !allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error(`Domain ${host} is outside this job's allowlist.`);
  }
  return url.toString();
}

export async function validateScrapingTarget(raw: string, allowedDomains: string[] = []) {
  const normalized = validateScrapingUrl(raw, allowedDomains);
  const url = new URL(normalized);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateIp(address))) {
    throw new Error("Targets resolving to private or local networks are blocked.");
  }
  return normalized;
}

export function assertScrapingEnabled() {
  if (process.env.SCRAPING_KILL_SWITCH?.toLowerCase() === "true") throw new Error("Scraping kill switch is active.");
}

export function boundedInput(input: ScrapingInput) {
  return {
    ...input,
    maxRequests: Math.max(1, Math.min(input.maxRequests ?? 10, 100)),
    maxConcurrency: Math.max(1, Math.min(input.maxConcurrency ?? 2, 5)),
    requestDelayMs: Math.max(250, input.requestDelayMs ?? 1000),
    timeoutMs: Math.max(5000, Math.min(input.timeoutMs ?? 30000, 120000)),
    retryLimit: Math.max(0, Math.min(input.retryLimit ?? 2, 5)),
  };
}

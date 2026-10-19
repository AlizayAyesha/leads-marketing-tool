/** Operator quota / wave audits must not count as a real Decision Maker PASS for production send. */

const QUOTA_CHECK_KEYS = [
  "linkedinWave",
  "linkedinTopup",
  "liEmailWave",
  "mapsColdPitch",
  "regionColdGmail",
  "linkedinConnectBuyers",
  "linkedinConnectionsMessage",
  "browserDiscoverWave",
  "twitterDmWave10",
  "forcedForOpenDmWave",
  "reach10Wave",
  "quotaBypass",
  "operatorQuota",
] as const;

export function auditLooksLikeQuotaPass(checks: unknown, summary?: string | null): boolean {
  if (checks && typeof checks === "object" && !Array.isArray(checks)) {
    const record = checks as Record<string, unknown>;
    if (QUOTA_CHECK_KEYS.some((key) => record[key] === true)) return true;
  }
  const text = (summary ?? "").trim();
  if (!text) return false;
  return /\b(operator (linkedin|quota)|cold gmail|force[- ]?pass|connection wave|dm wave|open dm wave)\b/i.test(text);
}

export const DEFAULT_MIN_COMMERCIAL_SCORE = 80;

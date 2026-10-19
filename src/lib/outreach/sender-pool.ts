/**
 * Pure helpers for the multi-inbox Gmail sender pool (no DB, unit-tested).
 *
 * Each connected inbox has its own dailySendLimit (default 1/day — warm-up friendly).
 * Approved drafts are assigned round-robin across enabled inboxes that are under their cap.
 * The global kill switch, daily send limit, suppression list and compliance footer still apply
 * upstream in the send gate; this module never bypasses them.
 */
export const DEFAULT_SENDER_DAILY_LIMIT = 1;

export function maxSenderDailyLimit(env: Record<string, string | undefined> = process.env) {
  const parsed = Number.parseInt(env.GMAIL_SENDER_MAX_DAILY_LIMIT ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

export function clampSenderDailyLimit(value: unknown, env: Record<string, string | undefined> = process.env) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SENDER_DAILY_LIMIT;
  return Math.min(n, maxSenderDailyLimit(env));
}

export type PoolAccount = {
  id: string;
  email: string;
  enabled: boolean;
  dailySendLimit: number;
  sentToday: number;
};

/** Accounts that can still send today. */
export function availableSenders(accounts: PoolAccount[]) {
  return accounts.filter((a) => a.enabled && a.sentToday < a.dailySendLimit);
}

/**
 * Round-robin pick. `cursor` is the index of the last used account in the stable (sorted) list.
 * Returns null when every account is disabled or at its cap.
 */
export function pickSender(accounts: PoolAccount[], cursor: number): { account: PoolAccount; cursor: number } | null {
  const ordered = [...accounts].sort((a, b) => a.email.localeCompare(b.email));
  if (ordered.length === 0) return null;
  for (let step = 1; step <= ordered.length; step += 1) {
    const index = (((cursor + step) % ordered.length) + ordered.length) % ordered.length;
    const candidate = ordered[index];
    if (candidate.enabled && candidate.sentToday < candidate.dailySendLimit) {
      return { account: candidate, cursor: index };
    }
  }
  return null;
}

/** Plan assignment of N drafts across accounts (used for previews and tests). */
export function planAssignments(accounts: PoolAccount[], drafts: number, cursor = -1) {
  const state = accounts.map((a) => ({ ...a }));
  const out: string[] = [];
  let cur = cursor;
  for (let i = 0; i < drafts; i += 1) {
    const picked = pickSender(state, cur);
    if (!picked) break;
    picked.account.sentToday += 1;
    const live = state.find((a) => a.id === picked.account.id)!;
    live.sentToday = picked.account.sentToday;
    out.push(picked.account.email);
    cur = picked.cursor;
  }
  return out;
}

export function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

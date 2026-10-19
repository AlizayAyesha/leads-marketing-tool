import "server-only";

import { prisma } from "@/lib/db/prisma";
import { HARD_DAILY_SEND_LIMIT } from "@/lib/outreach/policy";
import { countEmailsSentToday, getOutreachEnginePolicy } from "@/lib/outreach/sequence";

/** Max emails per home "Send email" click — operator-sized wave, not the daily cap. */
export const HOME_EMAIL_WAVE_LIMIT = 10;

export type HomeEmailPulse = {
  emailsSentToday: number;
  dailyCap: number;
  remainingToday: number;
  waveLimit: number;
  /** Approximate ready pool: remaining today capped at wave size. */
  readyEmails: number;
  lastSkipHint: string | null;
  lastWave: {
    sent: number;
    drafted: number;
    skipped: number;
    filtered: number;
    replied: number;
    at: string;
    reason?: string;
  } | null;
  /** Lifetime reply count among email-contacted leads (LeadOutcome.replied). */
  repliedTotal: number;
};

export async function getHomeEmailPulse(): Promise<HomeEmailPulse> {
  const policy = await getOutreachEnginePolicy();
  const dailyCap = Math.min(HARD_DAILY_SEND_LIMIT, Math.max(0, policy.dailySendLimit));
  const emailsSentToday = await countEmailsSentToday();
  const remainingToday = Math.max(0, dailyCap - emailsSentToday);

  const [last, repliedTotal] = await Promise.all([
    prisma.auditLog.findFirst({
      where: { action: "outreach.email_send_now" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.leadOutcome.count({
      where: { channel: "EMAIL", replied: true },
    }),
  ]);

  let lastWave: HomeEmailPulse["lastWave"] = null;
  if (last) {
    const payload = (last.payload ?? {}) as {
      sent?: number;
      drafted?: number;
      prepared?: number;
      skipped?: number;
      filtered?: number;
      replied?: number;
      aborted?: string;
    };
    lastWave = {
      sent: Number(payload.sent ?? 0),
      drafted: Number(payload.drafted ?? payload.prepared ?? 0),
      skipped: Number(payload.skipped ?? 0),
      filtered: Number(payload.filtered ?? 0),
      replied: Number(payload.replied ?? 0),
      at: last.createdAt.toISOString(),
      reason: typeof payload.aborted === "string" ? payload.aborted : undefined,
    };
  }

  const lastSkipHint = lastWave
    ? lastWave.reason
      ? lastWave.reason
      : lastWave.skipped > 0 || lastWave.filtered > 0
        ? `Last wave: filtered ${lastWave.filtered} · skipped ${lastWave.skipped}`
        : null
    : null;

  return {
    emailsSentToday,
    dailyCap,
    remainingToday,
    waveLimit: HOME_EMAIL_WAVE_LIMIT,
    readyEmails: Math.min(HOME_EMAIL_WAVE_LIMIT, remainingToday),
    lastSkipHint,
    lastWave,
    repliedTotal,
  };
}

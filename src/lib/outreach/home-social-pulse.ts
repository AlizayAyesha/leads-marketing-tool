import "server-only";

import { countLinkedInConfirmedSends } from "@/lib/linkedin/connection/usage";
import { getLinkedInDailyDashboard } from "@/lib/linkedin/daily/dashboard";
import { loadLinkedInDailySnapshot } from "@/lib/linkedin/daily/worker";
import { getOutreachEnginePolicy } from "@/lib/outreach/sequence";
import { countTwitterConfirmedDms, loadTwitterDailyCandidates } from "@/lib/twitter/daily/queue";
import { getSetting } from "@/lib/db/settings";
import { TWITTER_DAILY_SNAPSHOT_KEY } from "@/lib/twitter/daily/events";

function summarizeSkipCodes(skipped: Array<{ code: string }>, limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const row of skipped) {
    const code = String(row.code || "UNKNOWN").trim() || "UNKNOWN";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([code, n]) => `${code}×${n}`);
}

export type HomeSocialPulse = {
  linkedin: {
    connectionsToday: number;
    messagesToday: number;
    connectionCap: number;
    messageCap: number;
    readyConnections: number;
    readyMessages: number;
    skipMix: string[];
    lastWaveConnections: number | null;
    lastWaveMessages: number | null;
  };
  twitter: {
    dmsToday: number;
    followsToday: number;
    dmCap: number;
    readyDms: number;
    skipMix: string[];
    lastWaveDms: number | null;
    lastWaveFollows: number | null;
  };
};

export async function getHomeSocialPulse(): Promise<HomeSocialPulse> {
  const policy = await getOutreachEnginePolicy();
  const [liConfirmed, liDash, liSnap, twConfirmed, twCandidates, twSnap] = await Promise.all([
    countLinkedInConfirmedSends().catch(() => ({
      connectionsToday: 0,
      messagesToday: 0,
      connectionsRemaining: 10,
      messagesRemaining: 10,
      connectionCap: 10,
      messageCap: 10,
    })),
    getLinkedInDailyDashboard().catch(() => null),
    loadLinkedInDailySnapshot().catch(() => null),
    countTwitterConfirmedDms().catch(() => ({ dmsToday: 0, followsToday: 0 })),
    loadTwitterDailyCandidates(new Date(), 20).catch(() => []),
    getSetting(TWITTER_DAILY_SNAPSHOT_KEY, null as Record<string, unknown> | null).catch(() => null),
  ]);

  const tw = (twSnap && typeof twSnap === "object" ? twSnap : {}) as {
    sentCount?: number;
    followsThisWave?: number;
    skipMix?: string[];
    skipped?: Array<{ code: string }>;
  };

  const liSkipped = liDash?.skipped?.length
    ? liDash.skipped
    : liSnap?.skipped?.length
      ? liSnap.skipped
      : [];
  const twSkipMix = Array.isArray(tw.skipMix)
    ? tw.skipMix.slice(0, 6)
    : Array.isArray(tw.skipped)
      ? summarizeSkipCodes(tw.skipped)
      : [];

  return {
    linkedin: {
      connectionsToday: liConfirmed.connectionsToday,
      messagesToday: liConfirmed.messagesToday,
      connectionCap: Math.max(10, policy.linkedinConnectionDailyCap || 10),
      messageCap: Math.max(10, policy.linkedinMessageDailyCap || 10),
      readyConnections: liDash?.qualifiedConnections ?? 0,
      readyMessages: liDash?.qualifiedMessages ?? 0,
      skipMix: summarizeSkipCodes(liSkipped),
      lastWaveConnections:
        typeof liSnap?.connectionsSent === "number" ? liSnap.connectionsSent : null,
      lastWaveMessages: typeof liSnap?.messagesSent === "number" ? liSnap.messagesSent : null,
    },
    twitter: {
      dmsToday: twConfirmed.dmsToday,
      followsToday: twConfirmed.followsToday,
      dmCap: Math.max(10, policy.twitterDmDailyCap || 10),
      readyDms: twCandidates.length,
      skipMix: twSkipMix,
      lastWaveDms: typeof tw.sentCount === "number" ? tw.sentCount : null,
      lastWaveFollows: typeof tw.followsThisWave === "number" ? tw.followsThisWave : null,
    },
  };
}

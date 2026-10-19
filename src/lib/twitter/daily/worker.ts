import "server-only";

import { prisma } from "@/lib/db/prisma";
import { setSetting, writeAudit } from "@/lib/db/settings";
import { getOutreachEnginePolicy } from "@/lib/outreach/sequence";
import { HARD_TWITTER_DM_DAILY_CAP } from "@/lib/outreach/policy";
import { authorizeTwitterDailyOutreach, twitterDailyIdempotencyKey, twitterLocalDayKey } from "@/lib/twitter/daily/authorize";
import {
  HOME_TWITTER_DM_WAVE_LIMIT,
  HOME_TWITTER_FOLLOW_WAVE_LIMIT,
  TWITTER_DAILY_SNAPSHOT_KEY,
  TWITTER_DM_SENT_EVENT,
  TWITTER_FOLLOW_SENT_EVENT,
} from "@/lib/twitter/daily/events";
import {
  countTwitterConfirmedDms,
  loadTwitterDailyAttemptedKeys,
  loadTwitterDailyCandidates,
} from "@/lib/twitter/daily/queue";
import { runTwitterDailyOutreach, withTwitterDailyLock } from "@/lib/twitter/daily/run";
import { resolveTwitterSendProvider } from "@/lib/twitter/send/registry";

export async function runTwitterDailyOutreachWorker(
  now = new Date(),
  options: { waveLimit?: number } = {},
) {
  return withTwitterDailyLock(async () => {
    const policy = await getOutreachEnginePolicy();
    const sendProvider = await resolveTwitterSendProvider();
    const auth = authorizeTwitterDailyOutreach({
      policy,
      sendProviderConfigured: sendProvider.configured,
    });
    const waveLimit = Math.max(1, Math.min(HOME_TWITTER_DM_WAVE_LIMIT, options.waveLimit ?? HOME_TWITTER_DM_WAVE_LIMIT));
    const candidates = await loadTwitterDailyCandidates(
      now,
      Math.min(
        HARD_TWITTER_DM_DAILY_CAP,
        policy.twitterDmDailyCap || HARD_TWITTER_DM_DAILY_CAP,
        waveLimit * 3,
      ),
    );
    const confirmed = await countTwitterConfirmedDms(now);
    const attempted = await loadTwitterDailyAttemptedKeys(now);

    // Cap this wave so home click ≈ 10 DMs (not the full daily ceiling).
    const remainingRoom = Math.max(0, Math.min(HARD_TWITTER_DM_DAILY_CAP, policy.twitterDmDailyCap) - confirmed.dmsToday);
    const cappedCandidates = candidates.slice(0, Math.min(waveLimit, remainingRoom || waveLimit));

    const result = await runTwitterDailyOutreach({
      policy: {
        ...policy,
        twitterDmDailyCap: Math.min(policy.twitterDmDailyCap, confirmed.dmsToday + waveLimit),
      },
      sendProvider,
      candidates: cappedCandidates,
      dmsSentToday: confirmed.dmsToday,
      attempted,
      now,
    });

    let followsThisWave = 0;
    for (const sent of result.sent) {
      const key = twitterDailyIdempotencyKey({
        leadId: sent.id,
        day: twitterLocalDayKey(now),
      });
      await prisma.outreachEvent.create({
        data: {
          leadId: sent.id,
          type: TWITTER_DM_SENT_EVENT,
          channel: "X_TWITTER",
          payload: {
            kind: "dm",
            body: sent.body,
            provider: sent.provider,
            externalId: sent.externalId,
            evidence: sent.evidence ?? null,
            idempotencyKey: key,
            dailyCount: result.dmsSent,
            confirmed: true,
            followed: sent.evidence?.followed === true,
          },
        },
      });
      if (sent.evidence?.followed === true) {
        followsThisWave += 1;
        await prisma.outreachEvent.create({
          data: {
            leadId: sent.id,
            type: TWITTER_FOLLOW_SENT_EVENT,
            channel: "X_TWITTER",
            payload: {
              kind: "follow",
              provider: sent.provider,
              evidence: sent.evidence ?? null,
              withDm: true,
            },
          },
        });
      }
      if (sent.body) {
        await prisma.outreachDraft.updateMany({
          where: {
            leadId: sent.id,
            channel: "X_TWITTER",
            status: { in: ["PENDING_APPROVAL", "APPROVED", "EDITED", "DRAFT"] },
          },
          data: { status: "SENT", approvedAt: new Date(), approvedBy: "twitter-daily" },
        });
      }
      await prisma.lead.update({
        where: { id: sent.id },
        data: { status: "CONTACTED", lastActivityAt: new Date() },
      });
    }

    // Persist follow-only outcomes when DM failed but Follow succeeded.
    for (const skip of result.skipped) {
      if (followsThisWave >= HOME_TWITTER_FOLLOW_WAVE_LIMIT) break;
      if (!skip.id || skip.evidence?.followed !== true) continue;
      const already = await prisma.outreachEvent.findFirst({
        where: { leadId: skip.id, type: TWITTER_FOLLOW_SENT_EVENT },
      });
      if (already) continue;
      followsThisWave += 1;
      await prisma.outreachEvent.create({
        data: {
          leadId: skip.id,
          type: TWITTER_FOLLOW_SENT_EVENT,
          channel: "X_TWITTER",
          payload: {
            kind: "follow",
            code: skip.code,
            withDm: false,
            evidence: skip.evidence ?? null,
          },
        },
      });
    }

    const after = await countTwitterConfirmedDms(now);
    const snapshot = {
      at: now.toISOString(),
      auth: { code: result.code, reason: result.reason, canSend: result.canSend },
      dmsSent: result.dmsSent,
      dmCap: result.dmCap,
      followsToday: after.followsToday,
      followsThisWave,
      qualified: result.qualified,
      sentCount: result.sent.length,
      skippedCount: result.skipped.length,
      waveLimit,
      errors: result.errors,
      skipMix: summarizeSkipCodes(result.skipped),
    };
    await setSetting(TWITTER_DAILY_SNAPSHOT_KEY, snapshot);
    await writeAudit({
      action: "outreach.twitter.daily",
      entity: "setting",
      payload: snapshot,
    });

    return {
      ...result,
      snapshot,
      candidates: cappedCandidates.length,
      provider: sendProvider.id,
      configured: sendProvider.configured,
      followsThisWave,
      followsToday: after.followsToday,
      waveDms: result.sent.length,
      waveLimit,
      skipMix: summarizeSkipCodes(result.skipped),
    };
  });
}

function summarizeSkipCodes(skipped: Array<{ code: string }>) {
  const counts = new Map<string, number>();
  for (const row of skipped) {
    counts.set(row.code, (counts.get(row.code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([code, n]) => `${code}×${n}`);
}

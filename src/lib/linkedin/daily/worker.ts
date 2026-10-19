import "server-only";

import { prisma } from "@/lib/db/prisma";
import { getSetting, setSetting, writeAudit } from "@/lib/db/settings";
import { rankLinkedInProspects } from "@/lib/linkedin/connection/ranking";
import {
  checkLinkedInConnectionStatus,
  markLinkedInInviteAlreadyPending,
  recordAuthorizedLinkedInConnectionSend,
} from "@/lib/linkedin/connection/lifecycle";
import { loadLinkedInDailyCandidates } from "@/lib/linkedin/connection/queue";
import {
  countLinkedInConfirmedSends,
  loadLinkedInDailyAttemptedKeys,
} from "@/lib/linkedin/connection/usage";
import { authorizeLinkedInDailyOutreach, linkedInDailyIdempotencyKey, linkedInLocalDayKey } from "@/lib/linkedin/daily/authorize";
import { LINKEDIN_CONNECTION_SENT_EVENT, LINKEDIN_DAILY_SNAPSHOT_KEY, LINKEDIN_MESSAGE_SENT_EVENT } from "@/lib/linkedin/daily/events";
import { runLinkedInDailyOutreach, withLinkedInDailyLock, type LinkedInDailyCandidate } from "@/lib/linkedin/daily/run";
import { emptyLinkedInDailySnapshot, nextLinkedInReset, type LinkedInDailySnapshot } from "@/lib/linkedin/daily/snapshot";
import { recordLinkedInSendTrace } from "@/lib/linkedin/daily/trace";
import { resolveLinkedInSendProvider } from "@/lib/linkedin/send/registry";
import { getOutreachEnginePolicy } from "@/lib/outreach/sequence";
import { refreshStalePassAuditsForLeads } from "@/lib/outreach/audit-refresh";
import { syncLinkedInConnectedInboxes } from "@/lib/linkedin/session/sync";
import { flushLinkedInConversationDrafts } from "@/lib/linkedin/session/conversation-send";

/** Home / daily wave ceiling when remaining room allows. */
export const LINKEDIN_HOME_WAVE_LIMIT = 10;

function mergeRanked(
  ranked: ReturnType<typeof rankLinkedInProspects>,
  candidates: Array<{ id: string }>,
): LinkedInDailyCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return ranked.map((row) => ({ ...(byId.get(row.id) ?? {}), ...row }));
}


async function refreshRequestedLinkedInConnections() {
  const rows = await prisma.linkedInConnection.findMany({
    where: { status: "REQUESTED", stoppedAt: null },
    orderBy: { lastCheckedAt: "asc" },
    take: 25,
    select: { leadId: true },
  });
  for (const row of rows) {
    await checkLinkedInConnectionStatus(row.leadId).catch(() => null);
  }
}

export async function runLinkedInDailyOutreachWorker(
  now = new Date(),
  mode: "connections" | "messages" | "both" = "both",
) {
  return withLinkedInDailyLock(async () => {
    const policy = await getOutreachEnginePolicy();
    const sendProvider = await resolveLinkedInSendProvider();
    const auth = authorizeLinkedInDailyOutreach({
      policy,
      sendProviderConfigured: sendProvider.configured,
    });
    if (mode === "both") {
      await refreshRequestedLinkedInConnections();
    }
    const inbox =
      mode === "both"
        ? await syncLinkedInConnectedInboxes().catch(() => ({ checked: 0, ingested: 0 }))
        : { checked: 0, ingested: 0 };
    let { connectionCandidates, messageCandidates } = await loadLinkedInDailyCandidates(now);

    // Stale PASS (14d+) empties the queue — same operator refresh as home email.
    const refreshIds = [
      ...(mode !== "messages" ? connectionCandidates.map((c) => c.id) : []),
      ...(mode !== "connections" ? messageCandidates.map((c) => c.id) : []),
    ];
    const auditsRefreshed = await refreshStalePassAuditsForLeads(refreshIds, "operator linkedin daily refresh");
    if (auditsRefreshed > 0) {
      ({ connectionCandidates, messageCandidates } = await loadLinkedInDailyCandidates(now));
    }

    const confirmed = await countLinkedInConfirmedSends(now);
    const connLimit = mode === "messages" ? 0 : Math.min(LINKEDIN_HOME_WAVE_LIMIT, confirmed.connectionsRemaining);
    const msgLimit = mode === "connections" ? 0 : Math.min(LINKEDIN_HOME_WAVE_LIMIT, confirmed.messagesRemaining);
    const rankedConnections =
      connLimit > 0
        ? rankLinkedInProspects(connectionCandidates, {
            purpose: "connection_send",
            limit: connLimit,
            now,
          })
        : [];
    const rankedMessages =
      msgLimit > 0
        ? rankLinkedInProspects(messageCandidates, {
            purpose: "message_send",
            limit: msgLimit,
            now,
          })
        : [];
    const attempted = await loadLinkedInDailyAttemptedKeys(now);
    const result = await runLinkedInDailyOutreach({
      policy,
      sendProvider,
      connections: mergeRanked(rankedConnections, connectionCandidates),
      messages: mergeRanked(rankedMessages, messageCandidates),
      counters: {
        connectionsSent: confirmed.connectionsToday,
        messagesSent: confirmed.messagesToday,
      },
      attempted,
      now,
    });


    for (const skip of result.skipped) {
      if (!skip.id) continue;
      if (skip.code === "ALREADY_CONNECTED") {
        await checkLinkedInConnectionStatus(skip.id).catch(() => null);
      }
      // LinkedIn already shows Pending — record REQUESTED so we do not reopen this profile next wave.
      if (skip.code === "ALREADY_INVITED") {
        await markLinkedInInviteAlreadyPending(skip.id).catch(() => null);
      }
    }

    // Leave the last profile so Chrome does not look stuck on one person.
    if (mode === "connections" || mode === "both") {
      await import("@/lib/linkedin/session/open")
        .then((mod) => mod.openLinkedInFeed())
        .catch(() => null);
    }

    for (const sent of result.sent) {
      const key = linkedInDailyIdempotencyKey({
        leadId: sent.id,
        kind: sent.kind,
        day: linkedInLocalDayKey(now),
      });
      if (sent.kind === "connection") {
        await recordAuthorizedLinkedInConnectionSend(sent.id, {
          body: sent.body ?? "",
          provider: sent.provider ?? sendProvider.id,
          externalId: sent.externalId ?? null,
          idempotencyKey: key,
        }).catch(() => null);
      }
      await prisma.outreachEvent.create({
        data: {
          leadId: sent.id,
          type: sent.kind === "connection" ? LINKEDIN_CONNECTION_SENT_EVENT : LINKEDIN_MESSAGE_SENT_EVENT,
          channel: "LINKEDIN",
          payload: {
            kind: sent.kind,
            body: sent.body,
            provider: sent.provider,
            externalId: sent.externalId,
            evidence: sent.evidence ?? null,
            idempotencyKey: key,
            dailyCount: sent.kind === "connection" ? result.connectionsSent : result.messagesSent,
            confirmed: true,
          },
        },
      });
      await recordLinkedInSendTrace({
        leadId: sent.id,
        kind: sent.kind,
        body: sent.body ?? "",
        provider: sent.provider ?? sendProvider.id,
        externalId: sent.externalId ?? null,
      }).catch(() => null);
    }

    if (auth.canSend && mode !== "connections") {
      const remainingMessages = Math.max(0, confirmed.messagesRemaining - result.messagesSent);
      const flushed = await flushLinkedInConversationDrafts({
        sendProvider,
        now,
        remainingMessages,
      }).catch(() => ({ sent: 0, skipped: 0 }));
      result.messagesSent += flushed.sent;
    }

    const snapshot: LinkedInDailySnapshot = {
      ...emptyLinkedInDailySnapshot({
        now,
        resetAt: nextLinkedInReset(now),
        code: result.code,
        reason: result.reason,
        sendAvailable: sendProvider.configured,
      }),
      lastRunAt: now.toISOString(),
      nextRunAt: auth.ok ? nextLinkedInReset(now).toISOString() : null,
      connectionsSent: result.connectionsSent,
      messagesSent: result.messagesSent,
      qualifiedConnections: result.qualifiedConnections,
      qualifiedMessages: result.qualifiedMessages,
      errors: result.errors,
      skipped: result.skipped.slice(0, 40),
    };
    await setSetting(LINKEDIN_DAILY_SNAPSHOT_KEY, snapshot);
    await writeAudit({
      action: "linkedin.daily.run",
      entity: "linkedin_daily",
      payload: {
        mode,
        code: result.code,
        connectionsSent: result.connectionsSent,
        messagesSent: result.messagesSent,
        waveConnections: result.sent.filter((s) => s.kind === "connection").length,
        waveMessages: result.sent.filter((s) => s.kind === "message").length,
        qualifiedConnections: rankedConnections.length,
        qualifiedMessages: rankedMessages.length,
        auditsRefreshed,
        skipped: result.skipped.length,
        skipMix: summarizeSkipCodes(result.skipped),
        sendAvailable: sendProvider.configured,
        inboxChecked: inbox.checked,
        inboxIngested: inbox.ingested,
      },
    });
    return {
      ...result,
      snapshot,
      auth,
      auditsRefreshed,
      waveConnections: result.sent.filter((s) => s.kind === "connection").length,
      waveMessages: result.sent.filter((s) => s.kind === "message").length,
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

export async function loadLinkedInDailySnapshot(): Promise<LinkedInDailySnapshot> {
  return getSetting(LINKEDIN_DAILY_SNAPSHOT_KEY, emptyLinkedInDailySnapshot({}));
}

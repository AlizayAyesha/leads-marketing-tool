import "server-only";

import { productionLeadWhere } from "@/lib/analytics/production";
import { prisma } from "@/lib/db/prisma";
import { loadLinkedInDailyCandidates } from "@/lib/linkedin/connection/queue";
import { countLinkedInConfirmedSends, countLinkedInDailyUsage } from "@/lib/linkedin/connection/usage";
import { authorizeLinkedInDailyOutreach } from "@/lib/linkedin/daily/authorize";
import { loadLinkedInDailySnapshot } from "@/lib/linkedin/daily/worker";
import { linkedInProspectEligibility } from "@/lib/linkedin/connection/ranking";
import { resolveLinkedInSendProvider } from "@/lib/linkedin/send/registry";
import { LINKEDIN_SEND_UNAVAILABLE_REASON } from "@/lib/linkedin/send/types";
import { nextLinkedInReset } from "@/lib/linkedin/daily/snapshot";
import { getOutreachEnginePolicy } from "@/lib/outreach/sequence";
import { startOfLinkedInLocalDay } from "@/lib/linkedin/daily/authorize";

export async function getLinkedInDailyDashboard(now = new Date()) {
  const policy = await getOutreachEnginePolicy();
  const sendProvider = await resolveLinkedInSendProvider();
  const auth = authorizeLinkedInDailyOutreach({
    policy,
    sendProviderConfigured: sendProvider.configured,
  });
  const [{ connectionCandidates, messageCandidates }, confirmed, drafts, snapshot, pending, connected, meetings] =
    await Promise.all([
      loadLinkedInDailyCandidates(now),
      countLinkedInConfirmedSends(now),
      countLinkedInDailyUsage(now),
      loadLinkedInDailySnapshot(),
      prisma.linkedInConnection.count({ where: { status: "REQUESTED", lead: productionLeadWhere() } }),
      prisma.linkedInConnection.count({ where: { status: "CONNECTED", lead: productionLeadWhere() } }),
      prisma.conversation.count({
        where: { stage: { in: ["MEETING_BOOKED", "BOOKED"] }, lead: productionLeadWhere() },
      }),
    ]);

  const qualifiedConnections = connectionCandidates.filter((candidate) =>
    linkedInProspectEligibility(candidate, "connection_send", now).ok,
  ).length;
  const qualifiedMessages = messageCandidates.filter((candidate) =>
    linkedInProspectEligibility(candidate, "message", now).ok,
  ).length;
  const skipped = connectionCandidates
    .map((candidate) => {
      const eligibility = linkedInProspectEligibility(candidate, "connection_send", now);
      return eligibility.ok
        ? null
        : { leadId: candidate.leadId, kind: "connection" as const, code: eligibility.code, reason: eligibility.reason };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .slice(0, 12);

  return {
    policy,
    auth,
    sendAvailable: sendProvider.configured,
    unavailableReason: sendProvider.configured ? null : LINKEDIN_SEND_UNAVAILABLE_REASON,
    confirmed,
    drafts,
    snapshot,
    qualifiedConnections,
    qualifiedMessages,
    pendingConnections: pending,
    connected,
    meetings,
    resetAt: startOfLinkedInLocalDay(now),
    nextResetAt: nextLinkedInReset(now),
    skipped: snapshot.skipped.length ? snapshot.skipped : skipped,
    errors: snapshot.errors,
  };
}

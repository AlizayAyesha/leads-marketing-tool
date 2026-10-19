import "server-only";

import { prisma } from "@/lib/db/prisma";

export type LoopMetrics = {
  discovery: { leadsDiscovered: number; uniqueLeads: number; duplicateRate: number };
  qualification: { pass: number; hold: number; reject: number; passRate: number };
  opportunity: { detected: number; avgConfidenceObserved: number };
  outreach: {
    draftsCreated: number;
    draftsApproved: number;
    emailsSent: number;
    linkedinDrafts: number;
    instagramDrafts: number;
  };
  outcomes: {
    replyRate: number;
    positiveReplyRate: number;
    meetingRate: number;
    unsubscribeRate: number;
    wrongPersonRate: number;
  };
  safety: {
    blockedHoldReject: number;
    dncBlocks: number;
    killSwitchBlocks: number;
    duplicateSendBlocks: number;
  };
  recorded: {
    signalSets: number;
    traces: number;
    outcomes: number;
    evaluationExamples: number;
  };
};

function rate(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export async function getLoopMetrics(): Promise<LoopMetrics> {
  const [
    leads,
    uniqueLeads,
    pass,
    hold,
    reject,
    opportunities,
    observedOpps,
    draftsCreated,
    draftsApproved,
    emailsSent,
    linkedinDrafts,
    instagramDrafts,
    outcomes,
    blockedHoldReject,
    dncBlocks,
    sendBlocked,
    signalSets,
    traces,
    evaluationExamples,
    discoveredEvents,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { duplicateOfId: null } }),
    prisma.leadAudit.count({ where: { verdict: "PASS" } }),
    prisma.leadAudit.count({ where: { verdict: "HOLD" } }),
    prisma.leadAudit.count({ where: { verdict: "REJECT" } }),
    prisma.opportunity.count(),
    prisma.opportunity.count({ where: { confidence: "observed" } }),
    prisma.outreachDraft.count(),
    prisma.outreachDraft.count({ where: { status: { in: ["APPROVED", "SENT"] } } }),
    prisma.outreachEvent.count({ where: { type: "SENT", channel: "EMAIL" } }),
    prisma.outreachDraft.count({ where: { channel: "LINKEDIN" } }),
    prisma.outreachDraft.count({ where: { channel: "INSTAGRAM" } }),
    prisma.leadOutcome.findMany({ select: { sent: true, replied: true, interested: true, meeting: true, unsubscribe: true, wrongPerson: true } }),
    prisma.auditLog.count({ where: { action: "lead.blocked" } }),
    prisma.auditLog.count({ where: { action: "lead.do_not_contact" } }),
    prisma.auditLog.findMany({
      where: { action: "outreach.send.blocked" },
      select: { payload: true },
    }),
    prisma.leadSignalSet.count(),
    prisma.intelligenceTrace.count(),
    prisma.evaluationExample.count(),
    prisma.auditLog.count({ where: { action: "lead.discovered" } }),
  ]);

  const sentOutcomes = outcomes.filter((row) => row.sent).length;
  const replied = outcomes.filter((row) => row.replied).length;
  const positive = outcomes.filter((row) => row.interested || row.meeting).length;
  const meetings = outcomes.filter((row) => row.meeting).length;
  const unsubs = outcomes.filter((row) => row.unsubscribe).length;
  const wrong = outcomes.filter((row) => row.wrongPerson).length;
  const audits = pass + hold + reject;
  const killSwitchBlocks = sendBlocked.filter((row) => (row.payload as { code?: string }).code === "KILL_SWITCH").length;
  const duplicateSendBlocks = sendBlocked.filter((row) => (row.payload as { code?: string }).code === "ALREADY_SENT").length;

  return {
    discovery: {
      leadsDiscovered: discoveredEvents || leads,
      uniqueLeads,
      duplicateRate: rate(leads - uniqueLeads, leads),
    },
    qualification: {
      pass,
      hold,
      reject,
      passRate: rate(pass, audits),
    },
    opportunity: {
      detected: opportunities,
      avgConfidenceObserved: rate(observedOpps, opportunities),
    },
    outreach: {
      draftsCreated,
      draftsApproved,
      emailsSent,
      linkedinDrafts,
      instagramDrafts,
    },
    outcomes: {
      replyRate: rate(replied, sentOutcomes),
      positiveReplyRate: rate(positive, sentOutcomes),
      meetingRate: rate(meetings, sentOutcomes),
      unsubscribeRate: rate(unsubs, sentOutcomes),
      wrongPersonRate: rate(wrong, sentOutcomes),
    },
    safety: {
      blockedHoldReject,
      dncBlocks,
      killSwitchBlocks,
      duplicateSendBlocks,
    },
    recorded: {
      signalSets,
      traces,
      outcomes: outcomes.length,
      evaluationExamples,
    },
  };
}

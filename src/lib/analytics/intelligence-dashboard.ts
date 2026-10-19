import "server-only";

import { prisma } from "@/lib/db/prisma";
import { productionLeadWhere } from "@/lib/analytics/production";
import { ENGAGEMENT_NOT_AVAILABLE } from "@/lib/outreach/lifecycle-events";

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type IntelligenceDashboard = {
  today: {
    researched: number;
    qualifiedPass: number;
    sent: number;
    replies: number;
    positive: number;
    meetings: number;
    awaitingApproval: number;
  };
  funnel: {
    leads: number;
    researched: number;
    qualified: number;
    sent: number;
    replied: number;
    meetings: number;
    won: number;
  };
  northStar: {
    researchedCompanies: number;
    meetings: number;
    meetingsPer100Researched: number;
  };
  engagement: {
    opens: typeof ENGAGEMENT_NOT_AVAILABLE;
    clicks: typeof ENGAGEMENT_NOT_AVAILABLE;
    note: string;
  };
  attention: {
    pendingDrafts: number;
    unrepliedPositive: number;
    sequencesCompletedNoReply: number;
  };
  selection: {
    priority: number;
    nurture: number;
    rejected: number;
  };
};

export async function getIntelligenceDashboard(): Promise<IntelligenceDashboard> {
  const since = startOfUtcDay();
  const prod = productionLeadWhere();

  const [
    researchedToday,
    qualifiedToday,
    sentToday,
    repliesToday,
    positiveToday,
    meetingsToday,
    awaitingApproval,
    leads,
    researchedAll,
    qualifiedAll,
    sentAll,
    repliedAll,
    meetingsAll,
    won,
    pendingDrafts,
    unrepliedPositive,
    sequencesCompletedNoReply,
    selectionGroups,
  ] = await Promise.all([
    prisma.leadResearch.count({ where: { createdAt: { gte: since }, lead: prod } }),
    prisma.leadAudit.count({ where: { createdAt: { gte: since }, verdict: "PASS", lead: prod } }),
    prisma.outreachEvent.count({ where: { type: "SENT", createdAt: { gte: since }, lead: prod } }),
    prisma.outreachReply.count({ where: { createdAt: { gte: since }, lead: prod } }),
    prisma.leadOutcome.count({
      where: { createdAt: { gte: since }, interested: true, lead: prod },
    }),
    prisma.leadOutcome.count({ where: { createdAt: { gte: since }, meeting: true, lead: prod } }),
    prisma.outreachDraft.count({
      where: { status: "PENDING_APPROVAL", createdAt: { gte: since }, lead: prod },
    }),
    prisma.lead.count({ where: prod }),
    prisma.leadResearch.groupBy({ by: ["leadId"], where: { lead: prod } }).then((rows) => rows.length),
    prisma.leadAudit.count({ where: { verdict: "PASS", lead: prod } }),
    prisma.outreachEvent.count({ where: { type: "SENT", lead: prod } }),
    prisma.leadOutcome.count({ where: { replied: true, lead: prod } }),
    prisma.leadOutcome.count({ where: { meeting: true, lead: prod } }),
    prisma.lead.count({ where: { ...prod, status: "WON" } }),
    prisma.outreachDraft.count({ where: { status: "PENDING_APPROVAL", lead: prod } }),
    prisma.leadOutcome.count({
      where: { interested: true, meeting: false, replied: true, lead: { ...prod, status: { not: "MEETING" } } },
    }),
    prisma.leadOutcome.count({ where: { noResponse: true, sequenceStopped: true, lead: prod } }),
    prisma.opportunity.groupBy({
      by: ["selection"],
      where: { lead: prod },
      _count: { _all: true },
    }),
  ]);

  const selectionCount = (value: string) =>
    selectionGroups.find((row) => row.selection === value)?._count._all ?? 0;

  const meetingsPer100 =
    researchedAll > 0 ? Math.round((meetingsAll / researchedAll) * 1000) / 10 : 0;

  return {
    today: {
      researched: researchedToday,
      qualifiedPass: qualifiedToday,
      sent: sentToday,
      replies: repliesToday,
      positive: positiveToday,
      meetings: meetingsToday,
      awaitingApproval,
    },
    funnel: {
      leads,
      researched: researchedAll,
      qualified: qualifiedAll,
      sent: sentAll,
      replied: repliedAll,
      meetings: meetingsAll,
      won,
    },
    northStar: {
      researchedCompanies: researchedAll,
      meetings: meetingsAll,
      meetingsPer100Researched: meetingsPer100,
    },
    engagement: {
      opens: ENGAGEMENT_NOT_AVAILABLE,
      clicks: ENGAGEMENT_NOT_AVAILABLE,
      note: "Gmail and LinkedIn opens/clicks are not observed in Jarvis. Do not treat missing tracking as zero engagement.",
    },
    attention: {
      pendingDrafts,
      unrepliedPositive,
      sequencesCompletedNoReply,
    },
    selection: {
      priority: selectionCount("PRIORITY"),
      nurture: selectionCount("NURTURE"),
      rejected: selectionCount("REJECT"),
    },
  };
}

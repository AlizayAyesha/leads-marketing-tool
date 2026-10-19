import "server-only";

import { productionLeadWhere } from "@/lib/analytics/production";
import { prisma } from "@/lib/db/prisma";

export async function getOverviewMetrics() {
  const [
    total,
    newest,
    hot,
    warm,
    contacted,
    replied,
    meetings,
    opportunities,
    won,
    pendingDrafts,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({
      where: { createdAt: { gte: startOfDay() } },
    }),
    prisma.lead.count({ where: { temperature: "HOT" } }),
    prisma.lead.count({ where: { temperature: "WARM" } }),
    prisma.lead.count({ where: { status: "CONTACTED" } }),
    prisma.lead.count({ where: { status: { in: ["REPLIED", "INTERESTED"] } } }),
    prisma.lead.count({ where: { status: "MEETING" } }),
    prisma.opportunity.count(),
    prisma.lead.count({ where: { status: "WON" } }),
    prisma.outreachDraft.count({
      where: { status: { in: ["PENDING_APPROVAL", "EDITED"] }, NOT: { stepKind: "TEST_TRANSPORT" } },
    }),
  ]);

  const conversion = total ? (won / total) * 100 : 0;
  return {
    total,
    newest,
    hot,
    warm,
    contacted,
    replied,
    meetings,
    opportunities,
    won,
    pendingDrafts,
    conversion,
  };
}

export async function getLeadTable(take = 100) {
  return prisma.lead.findMany({
    orderBy: { lastActivityAt: "desc" },
    take,
    include: {
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      audits: { orderBy: { createdAt: "desc" }, take: 1 },
      opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

export async function getLeadFile(id: string) {
  return prisma.lead.findFirst({
    where: { OR: [{ id }, { leadId: id }] },
    include: {
      research: { orderBy: { createdAt: "desc" }, take: 3 },
      scores: { orderBy: { createdAt: "desc" }, take: 3 },
      audits: { orderBy: { createdAt: "desc" }, take: 3 },
      opportunities: { orderBy: { createdAt: "desc" }, take: 3 },
      drafts: { orderBy: { createdAt: "desc" }, take: 5 },
      events: { orderBy: { createdAt: "desc" }, take: 20 },
      sequences: { orderBy: { enrolledAt: "desc" }, take: 3, include: { steps: { orderBy: { stepIndex: "asc" } } } },
      replies: { orderBy: { createdAt: "desc" }, take: 5 },
      agentRuns: { orderBy: { createdAt: "desc" }, take: 12, include: { agent: true } },
      signalSets: { orderBy: { createdAt: "desc" }, take: 1 },
      traces: { orderBy: { createdAt: "desc" }, take: 1 },
      outcomes: { orderBy: { createdAt: "desc" }, take: 1 },
      linkedinResearch: { orderBy: { retrievedAt: "desc" }, take: 1 },
      linkedinConnections: { take: 1 },
      conversations: { orderBy: { updatedAt: "desc" }, take: 1 },
      instagramResearch: { orderBy: { retrievedAt: "desc" }, take: 1 },
    },
  });
}

export async function getApprovalQueue() {
  return prisma.outreachDraft.findMany({
    where: {
      status: { in: ["PENDING_APPROVAL", "EDITED"] },
      NOT: { stepKind: "TEST_TRANSPORT" },
      lead: productionLeadWhere(),
    },
    include: {
      lead: {
        include: {
          scores: { orderBy: { createdAt: "desc" }, take: 1 },
          audits: { orderBy: { createdAt: "desc" }, take: 1 },
          research: { orderBy: { createdAt: "desc" }, take: 1 },
          opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getOutreachBoard() {
  const production = productionLeadWhere();
  const [policy, sequences, sentToday, replies, linkedInQuota, testSequences] = await Promise.all([
    import("@/lib/outreach/sequence").then((mod) => mod.getOutreachEnginePolicy()),
    prisma.outreachSequence.findMany({
      where: { lead: production, status: "ACTIVE" },
      orderBy: { enrolledAt: "desc" },
      take: 20,
      include: {
        lead: true,
        steps: { orderBy: { stepIndex: "asc" } },
      },
    }),
    import("@/lib/outreach/sequence").then((mod) => mod.countSentToday()),
    prisma.outreachReply.findMany({
      where: { lead: production },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { lead: true },
    }),
    import("@/lib/linkedin/connection/usage")
      .then((mod) => mod.countLinkedInDailyUsage())
      .catch(() =>
        import("@/lib/linkedin/connection/quota").then((mod) =>
          mod.linkedInDailyQuota({ connectionsToday: 0, messagesToday: 0 }),
        ),
      ),
    prisma.outreachSequence.count({
      where: { status: "ACTIVE", NOT: { lead: production } },
    }),
  ]);
  return { policy, sequences, sentToday, replies, linkedInQuota, testSequenceCount: testSequences };
}

export async function getResearchFeed() {
  return prisma.leadResearch.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { lead: true },
  });
}

export async function getAgentCenter() {
  const [agents, recentRuns, queued] = await Promise.all([
    prisma.agent.findMany({ orderBy: { name: "asc" } }),
    prisma.agentRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { agent: true, lead: true },
    }),
    prisma.task.groupBy({
      by: ["status"],
      _count: true,
    }),
  ]);
  return { agents, recentRuns, queued };
}

function startOfDay() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

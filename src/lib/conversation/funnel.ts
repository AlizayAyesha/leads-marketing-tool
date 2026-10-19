import "server-only";

import { productionLeadWhere } from "@/lib/analytics/production";
import { prisma } from "@/lib/db/prisma";

function startOfDay(now = new Date()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function getSalesConversionFunnel(now = new Date()) {
  const since = startOfDay(now);
  const [
    connections,
    accepted,
    conversations,
    problems,
    qualified,
    pitches,
    meetings,
    booked,
    proposals,
    won,
    linkedinLinks,
    linkedinBooked,
    linkedinConversations,
    linkedinClients,
    linkedinClicks,
  ] = await Promise.all([
    prisma.linkedInConnection.count({
      where: { recommendedAt: { gte: since }, lead: productionLeadWhere() },
    }),
    prisma.linkedInConnection.count({
      where: { status: "CONNECTED", connectedAt: { gte: since }, lead: productionLeadWhere() },
    }),
    prisma.conversation.count({
      where: { updatedAt: { gte: since }, stage: { notIn: ["NONE", "STOPPED"] }, lead: productionLeadWhere() },
    }),
    prisma.conversation.count({
      where: { updatedAt: { gte: since }, intentScore: { gte: 2 }, lead: productionLeadWhere() },
    }),
    prisma.conversation.count({
      where: { updatedAt: { gte: since }, intentScore: { gte: 3 }, lead: productionLeadWhere() },
    }),
    prisma.conversation.count({
      where: {
        updatedAt: { gte: since },
        stage: { in: ["PITCH", "SOLUTION_MATCH", "INTEREST"] },
        lead: productionLeadWhere(),
      },
    }),
    prisma.conversation.count({
      where: {
        updatedAt: { gte: since },
        stage: { in: ["MEETING", "MEETING_PROPOSED", "LINK_SENT", "BOOKING_STARTED", "BOOKED", "MEETING_BOOKED", "COMPLETED"] },
        lead: productionLeadWhere(),
      },
    }),
    prisma.conversation.count({
      where: { stage: { in: ["BOOKED", "MEETING_BOOKED", "COMPLETED"] }, lead: productionLeadWhere() },
    }),
    prisma.lead.count({ where: { AND: [productionLeadWhere(), { status: "PROPOSAL" }] } }),
    prisma.lead.count({ where: { AND: [productionLeadWhere(), { status: "WON" }] } }),
    prisma.conversation.count({
      where: { meetingSource: "LINKEDIN", linkSentAt: { not: null }, lead: productionLeadWhere() },
    }),
    prisma.conversation.count({
      where: { meetingSource: "LINKEDIN", bookedAt: { not: null }, lead: productionLeadWhere() },
    }),
    prisma.conversation.count({
      where: { channel: "LINKEDIN", stage: { notIn: ["NONE", "STOPPED"] }, lead: productionLeadWhere() },
    }),
    prisma.lead.count({
      where: {
        AND: [productionLeadWhere(), { status: "WON" }],
        conversations: { some: { meetingSource: "LINKEDIN", bookedAt: { not: null } } },
      },
    }),
    prisma.conversation.count({
      where: { meetingSource: "LINKEDIN", ctaClickedAt: { not: null }, lead: productionLeadWhere() },
    }),
  ]);

  return {
    today: {
      connections,
      accepted,
      conversations,
      problemsIdentified: problems,
      qualifiedOpportunities: qualified,
      pitches,
      meetings,
    },
    pipeline: {
      booked,
      proposals,
      won,
      linkedinLinks,
      linkedinBooked,
      linkedinConversations,
      linkedinClicks,
      linkedinClients,
    },
  };
}

import "server-only";

import { prisma } from "@/lib/db/prisma";

export async function getFiverrChannelStats() {
  const [
    researched,
    qualified,
    rejected,
    awaiting,
    submitted,
    replied,
    won,
    inquiries,
    gigs,
  ] = await Promise.all([
    prisma.freelanceOpportunity.count({ where: { platform: "FIVERR" } }),
    prisma.freelanceOpportunity.count({
      where: { platform: "FIVERR", classification: { in: ["EXCELLENT", "GOOD"] } },
    }),
    prisma.freelanceOpportunity.count({
      where: { platform: "FIVERR", status: "SKIPPED" },
    }),
    prisma.freelanceProposal.count({
      where: { kind: "FIVERR_RESPONSE", status: "AWAITING_APPROVAL" },
    }),
    prisma.freelanceProposal.count({
      where: { kind: "FIVERR_RESPONSE", status: { in: ["SUBMITTED", "REPLIED", "WON"] } },
    }),
    prisma.freelanceProposal.count({
      where: { kind: "FIVERR_RESPONSE", status: { in: ["REPLIED", "WON"] } },
    }),
    prisma.freelanceOpportunity.count({ where: { platform: "FIVERR", status: "WON" } }),
    prisma.buyerInquiry.count({ where: { platform: "FIVERR" } }),
    prisma.gigProfile.count({ where: { platform: "FIVERR" } }),
  ]);
  const wonRows = await prisma.freelanceOpportunity.findMany({
    where: { platform: "FIVERR", status: "WON", budgetAmount: { not: null } },
    select: { budgetAmount: true },
  });
  const revenue = wonRows.reduce((sum, row) => sum + (row.budgetAmount ?? 0), 0);
  const aov = wonRows.length ? Math.round(revenue / wonRows.length) : null;
  return {
    researched,
    qualified,
    rejected,
    awaiting,
    submitted,
    replied,
    won,
    inquiries,
    gigs,
    revenue,
    averageOrderValue: aov,
    note: "Orders/revenue only update when the operator marks a Fiverr opportunity WON with a budget. Jarvis does not pull Fiverr payouts.",
  };
}

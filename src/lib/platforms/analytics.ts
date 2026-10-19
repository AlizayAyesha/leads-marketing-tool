import "server-only";

import { prisma } from "@/lib/db/prisma";

const MIN_SAMPLES = 8;

export async function platformPerformance() {
  const platforms = ["UPWORK", "FIVERR"] as const;
  const rows = [];
  for (const platform of platforms) {
    const [opportunities, qualified, proposals, approved, submitted, won] = await Promise.all([
      prisma.freelanceOpportunity.count({ where: { platform } }),
      prisma.freelanceOpportunity.count({
        where: { platform, classification: { in: ["EXCELLENT", "GOOD"] } },
      }),
      prisma.freelanceProposal.count({
        where: {
          kind: platform === "UPWORK" ? "UPWORK_PROPOSAL" : "FIVERR_RESPONSE",
        },
      }),
      prisma.freelanceProposal.count({
        where: {
          kind: platform === "UPWORK" ? "UPWORK_PROPOSAL" : "FIVERR_RESPONSE",
          status: { in: ["APPROVED", "SUBMITTED", "REPLIED", "WON"] },
        },
      }),
      prisma.freelanceProposal.count({
        where: {
          kind: platform === "UPWORK" ? "UPWORK_PROPOSAL" : "FIVERR_RESPONSE",
          status: { in: ["SUBMITTED", "REPLIED", "WON"] },
        },
      }),
      prisma.freelanceOpportunity.count({ where: { platform, status: "WON" } }),
    ]);
    const conversion = submitted ? (won / submitted) * 100 : 0;
    rows.push({
      platform,
      opportunities,
      qualified,
      proposals,
      approved,
      submitted,
      won,
      conversion,
      enoughData: opportunities >= MIN_SAMPLES,
    });
  }
  const ready = rows.every((row) => row.enoughData);
  return {
    rows,
    conclusion: ready
      ? pickLeader(rows)
      : `Not enough historical data yet (need at least ${MIN_SAMPLES} opportunities per platform). No winner is declared.`,
  };
}

function pickLeader(
  rows: { platform: string; qualified: number; won: number; conversion: number }[],
) {
  const ranked = [...rows].sort((a, b) => b.won - a.won || b.qualified - a.qualified);
  return `${ranked[0]?.platform} currently has more recorded wins/qualified work in Jarvis memory. Treat this as a snapshot, not a forecast.`;
}

export async function unansweredOpportunities() {
  return prisma.freelanceOpportunity.findMany({
    where: { status: { in: ["NEW", "QUALIFIED", "RESEARCHED"] } },
    orderBy: [{ fitScore: "desc" }, { createdAt: "desc" }],
    take: 30,
  });
}

export async function topOpportunities(take = 20) {
  return prisma.freelanceOpportunity.findMany({
    where: { status: { notIn: ["SKIPPED", "LOST"] } },
    orderBy: [{ fitScore: "desc" }, { createdAt: "desc" }],
    take,
  });
}

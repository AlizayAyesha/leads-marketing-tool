import "server-only";

import { prisma } from "@/lib/db/prisma";

export async function buildEvaluationRow(leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { OR: [{ id: leadId }, { leadId }] },
    include: {
      signalSets: { orderBy: { createdAt: "desc" }, take: 1 },
      opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
      audits: { orderBy: { createdAt: "desc" }, take: 1 },
      drafts: { orderBy: { createdAt: "desc" }, take: 1 },
      outcomes: { orderBy: { createdAt: "desc" }, take: 1 },
      traces: { orderBy: { createdAt: "desc" }, take: 1 },
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!lead) return null;
  return {
    leadId: lead.leadId,
    features: {
      industry: lead.industry,
      location: lead.location,
      hasEmail: Boolean(lead.email),
      hasLinkedIn: Boolean(lead.linkedinUrl),
      hasInstagram: Boolean(lead.instagramUrl),
      temperature: lead.temperature,
      score: lead.scores[0]?.score ?? null,
    },
    signals: lead.signalSets[0]?.payload ?? null,
    opportunity: lead.opportunities[0]
      ? {
          problem: lead.opportunities[0].problem,
          evidence: lead.opportunities[0].evidence,
          recommendedService: lead.opportunities[0].recommendedService,
          confidence: lead.opportunities[0].confidence,
          score: lead.opportunities[0].score,
        }
      : null,
    decision: lead.audits[0]
      ? {
          verdict: lead.audits[0].verdict,
          score: lead.audits[0].score,
          reasons: lead.audits[0].summary,
          promptVersion: lead.audits[0].promptVersion,
          modelProvider: lead.audits[0].modelProvider,
        }
      : null,
    action: lead.drafts[0]
      ? {
          channel: lead.drafts[0].channel,
          status: lead.drafts[0].status,
          decisionId: lead.drafts[0].decisionId,
          promptVersion: lead.drafts[0].promptVersion,
        }
      : null,
    outcome: lead.outcomes[0] ?? null,
    traceId: lead.traces[0]?.id ?? null,
  };
}

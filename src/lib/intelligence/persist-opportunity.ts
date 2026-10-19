import "server-only";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { evaluateLead, rawFromRecord, type LeadEvaluation } from "@/lib/intelligence/evaluate";
import { opportunityFieldsFromEvaluation } from "@/lib/intelligence/persist-opportunity-fields";
import { productionLeadWhere } from "@/lib/analytics/production";
import { CLASSIFIED_SELECTIONS, mergeClassifyBatch } from "@/lib/intelligence/classify-candidates";
import { findingsToClaims } from "@/lib/intelligence/evidence";
import type { WebsiteSnapshot } from "@/types";

export async function persistCommercialOpportunity(input: {
  leadId: string;
  evaluation: LeadEvaluation;
  mode?: string;
  signalSetId?: string | null;
  traceId?: string | null;
  extraEvidenceItems?: unknown[];
  problemOverride?: string;
  writeScore?: boolean;
}) {
  const fields = opportunityFieldsFromEvaluation(input.evaluation);
  const extra = Array.isArray(input.extraEvidenceItems) ? input.extraEvidenceItems : [];
  const evidenceItems = [...(fields.evidenceItems as unknown[]), ...extra];
  const data = {
    problem: input.problemOverride ?? fields.problem,
    evidence: fields.evidence,
    evidenceUrl: fields.evidenceUrl,
    recommendedService: fields.recommendedService,
    suggestedOffer: fields.suggestedOffer,
    projectCategory: fields.projectCategory,
    nextStep: fields.nextStep,
    confidence: fields.confidence,
    selection: fields.selection,
    icpId: fields.icpId,
    score: fields.score,
    mode: input.mode ?? "heuristic",
    signalSetId: input.signalSetId ?? undefined,
    traceId: input.traceId ?? undefined,
    evidenceItems: evidenceItems as Prisma.InputJsonValue,
  };

  const existing = await prisma.opportunity.findFirst({
    where: { leadId: input.leadId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const row = existing
    ? await prisma.opportunity.update({ where: { id: existing.id }, data })
    : await prisma.opportunity.create({ data: { leadId: input.leadId, ...data } });

  if (input.writeScore === false) return row;

  await prisma.leadScore.create({
    data: {
      leadId: input.leadId,
      score: input.evaluation.commercial.total,
      temperature: input.evaluation.score.classification,
      reason: input.evaluation.reason,
      breakdown: {
        ...input.evaluation.commercial.breakdown,
        buyNowScore: input.evaluation.commercial.total,
        priority: input.evaluation.commercial.priority,
        selection: input.evaluation.commercial.brief.selection,
        commercial: input.evaluation.commercial.brief,
        decision: input.evaluation.decision,
      },
      evidenceUsed: [`opportunity:${input.evaluation.opportunity.opportunityKey}`, `selection:${fields.selection}`],
      mode: input.mode ?? "heuristic",
    },
  });

  return row;
}

export type ClassifyCounts = {
  classified: number;
  newThisRunEvaluated: number;
  existingUnclassifiedEvaluated: number;
  priority: number;
  nurture: number;
  rejected: number;
};

const unclassifiedLeadWhere = {
  AND: [
    productionLeadWhere(),
    {
      NOT: {
        opportunities: {
          some: {
            selection: { in: CLASSIFIED_SELECTIONS },
          },
        },
      },
    },
  ],
};

export async function classifyUnclassifiedProductionLeads(since: Date, take = 40): Promise<ClassifyCounts> {
  const cap = Math.min(Math.max(take, 1), 40);
  const include = {
    research: { orderBy: { createdAt: "desc" as const }, take: 1 },
    opportunities: { orderBy: { createdAt: "desc" as const }, take: 1 },
  };

  const [newThisRun, existingUnclassified] = await Promise.all([
    prisma.lead.findMany({
      where: { AND: [...unclassifiedLeadWhere.AND, { createdAt: { gte: since } }] },
      orderBy: { createdAt: "desc" },
      take: cap,
      include,
    }),
    prisma.lead.findMany({
      where: {
        AND: [...unclassifiedLeadWhere.AND, { createdAt: { lt: since } }],
      },
      orderBy: { createdAt: "desc" },
      take: cap,
      include,
    }),
  ]);

  const merged = mergeClassifyBatch(
    newThisRun.map((lead) => ({
      ...lead,
      selection: lead.opportunities[0]?.selection ?? null,
    })),
    existingUnclassified.map((lead) => ({
      ...lead,
      selection: lead.opportunities[0]?.selection ?? null,
    })),
    cap,
  );

  const counts: ClassifyCounts = {
    classified: 0,
    newThisRunEvaluated: 0,
    existingUnclassifiedEvaluated: 0,
    priority: 0,
    nurture: 0,
    rejected: 0,
  };

  for (const lead of merged.batch) {
    const snapshot = (lead.research[0]?.rawSnapshot as WebsiteSnapshot | null) ?? null;
    const evaluation = evaluateLead({
      raw: rawFromRecord(lead),
      snapshot,
      blocked: lead.suppressed || lead.status === "DO_NOT_CONTACT",
      evidence: findingsToClaims(lead.research[0]?.findings),
    });
    await persistCommercialOpportunity({ leadId: lead.id, evaluation, mode: "discovery-classify", writeScore: false });
    counts.classified += 1;
    if (lead.createdAt >= since) counts.newThisRunEvaluated += 1;
    else counts.existingUnclassifiedEvaluated += 1;
    if (evaluation.commercial.brief.selection === "PRIORITY") counts.priority += 1;
    else if (evaluation.commercial.brief.selection === "NURTURE") counts.nurture += 1;
    else counts.rejected += 1;
  }

  return counts;
}

import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { remember } from "@/lib/brain/memory";

export async function startTrace(leadId: string) {
  await prisma.intelligenceTrace.updateMany({
    where: { leadId, closedAt: null },
    data: { closedAt: new Date() },
  });
  return prisma.intelligenceTrace.create({ data: { leadId } });
}

export async function latestOpenTrace(leadId: string) {
  return prisma.intelligenceTrace.findFirst({
    where: { leadId, closedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export async function ensureTrace(leadId: string) {
  return (await latestOpenTrace(leadId)) ?? startTrace(leadId);
}

export async function patchTrace(
  traceId: string,
  data: {
    signalSetId?: string | null;
    decisionId?: string | null;
    opportunityId?: string | null;
    linkedinResearchId?: string | null;
    instagramResearchId?: string | null;
    linkedinConnectionId?: string | null;
    draftId?: string | null;
    outcomeId?: string | null;
    agentRunId?: string;
  },
) {
  const current = await prisma.intelligenceTrace.findUnique({ where: { id: traceId } });
  const agentRunIds = Array.isArray(current?.agentRunIds) ? [...(current.agentRunIds as string[])] : [];
  if (data.agentRunId && !agentRunIds.includes(data.agentRunId)) agentRunIds.push(data.agentRunId);
  return prisma.intelligenceTrace.update({
    where: { id: traceId },
    data: {
      signalSetId: data.signalSetId ?? undefined,
      decisionId: data.decisionId ?? undefined,
      opportunityId: data.opportunityId ?? undefined,
      linkedinResearchId: data.linkedinResearchId ?? undefined,
      instagramResearchId: data.instagramResearchId ?? undefined,
      linkedinConnectionId: data.linkedinConnectionId ?? undefined,
      draftId: data.draftId ?? undefined,
      outcomeId: data.outcomeId ?? undefined,
      agentRunIds: agentRunIds as Prisma.InputJsonValue,
    },
  });
}

export async function rememberTrace(input: {
  leadId: string;
  publicLeadId?: string | null;
  kind: string;
  content: string;
  traceId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await remember({
    kind: input.kind,
    subject: input.publicLeadId || input.leadId,
    content: input.content,
    metadata: { leadId: input.leadId, traceId: input.traceId ?? null, ...input.metadata },
  });
}

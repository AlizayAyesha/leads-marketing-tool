import "server-only";

import type { OutreachChannel, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import {
  classifyEvaluation,
  outcomeContractSchema,
  type OutcomeContract,
} from "@/lib/contracts/outcome";
import { ensureTrace, patchTrace, rememberTrace } from "@/lib/intelligence/trace";

const EMPTY_OUTCOME: Omit<OutcomeContract, "leadId" | "channel"> = {
  sent: false,
  delivered: null,
  replied: false,
  interested: false,
  meeting: false,
  pricing: false,
  notInterested: false,
  wrongPerson: false,
  unsubscribe: false,
  bounced: false,
  noResponse: false,
  sequenceStopped: false,
  status: "none",
  replyIntent: null,
};

function canonicalStatus(outcome: Omit<OutcomeContract, "leadId" | "channel">): OutcomeContract["status"] {
  if (outcome.unsubscribe) return "unsubscribe";
  if (outcome.wrongPerson) return "wrong_person";
  if (outcome.meeting) return "meeting";
  if (outcome.interested) return "interested";
  if (outcome.pricing) return "pricing";
  if (outcome.notInterested) return "not_interested";
  if (outcome.bounced) return "bounced";
  if (outcome.replied) return "replied";
  if (outcome.sequenceStopped) return "sequence_stopped";
  if (outcome.sent && !outcome.replied) return "no_response";
  if (outcome.sent) return "sent";
  return "none";
}

export async function recordLeadOutcome(input: {
  leadId: string;
  channel?: OutreachChannel | null;
  patch: Partial<OutcomeContract>;
  draftId?: string | null;
  decisionId?: string | null;
  opportunityId?: string | null;
  traceId?: string | null;
}) {
  const trace = input.traceId
    ? await prisma.intelligenceTrace.findUnique({ where: { id: input.traceId } })
    : await ensureTrace(input.leadId);
  const existing = await prisma.leadOutcome.findFirst({
    where: { leadId: input.leadId, traceId: trace?.id ?? input.traceId ?? undefined },
    orderBy: { createdAt: "desc" },
  });
  const merged = {
    ...EMPTY_OUTCOME,
    leadId: input.leadId,
    channel: input.channel ?? existing?.channel ?? null,
    sent: existing?.sent ?? false,
    delivered: existing?.delivered ?? null,
    replied: existing?.replied ?? false,
    interested: existing?.interested ?? false,
    meeting: existing?.meeting ?? false,
    pricing: existing?.pricing ?? false,
    notInterested: existing?.notInterested ?? false,
    wrongPerson: existing?.wrongPerson ?? false,
    unsubscribe: existing?.unsubscribe ?? false,
    bounced: existing?.bounced ?? false,
    noResponse: existing?.noResponse ?? false,
    sequenceStopped: existing?.sequenceStopped ?? false,
    status: (existing?.status as OutcomeContract["status"]) ?? "none",
    replyIntent: existing?.replyIntent ?? null,
    ...input.patch,
  };
  merged.status = canonicalStatus(merged);
  const parsed = outcomeContractSchema.parse(merged);

  const row = existing
    ? await prisma.leadOutcome.update({
        where: { id: existing.id },
        data: {
          channel: parsed.channel,
          sent: parsed.sent,
          delivered: parsed.delivered,
          replied: parsed.replied,
          interested: parsed.interested,
          meeting: parsed.meeting,
          pricing: parsed.pricing,
          notInterested: parsed.notInterested,
          wrongPerson: parsed.wrongPerson,
          unsubscribe: parsed.unsubscribe,
          bounced: parsed.bounced,
          noResponse: parsed.noResponse,
          sequenceStopped: parsed.sequenceStopped,
          status: parsed.status,
          replyIntent: parsed.replyIntent,
          draftId: input.draftId ?? existing.draftId,
          decisionId: input.decisionId ?? existing.decisionId,
          opportunityId: input.opportunityId ?? existing.opportunityId,
        },
      })
    : await prisma.leadOutcome.create({
        data: {
          leadId: input.leadId,
          traceId: trace?.id ?? null,
          channel: parsed.channel,
          sent: parsed.sent,
          delivered: parsed.delivered,
          replied: parsed.replied,
          interested: parsed.interested,
          meeting: parsed.meeting,
          pricing: parsed.pricing,
          notInterested: parsed.notInterested,
          wrongPerson: parsed.wrongPerson,
          unsubscribe: parsed.unsubscribe,
          bounced: parsed.bounced,
          noResponse: parsed.noResponse,
          sequenceStopped: parsed.sequenceStopped,
          status: parsed.status,
          replyIntent: parsed.replyIntent,
          draftId: input.draftId ?? null,
          decisionId: input.decisionId ?? null,
          opportunityId: input.opportunityId ?? null,
        },
      });

  if (trace) await patchTrace(trace.id, { outcomeId: row.id });
  await writeAudit({
    action: "outcome.recorded",
    entity: "lead_outcome",
    entityId: row.id,
    payload: { leadId: input.leadId, status: parsed.status },
  });

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    include: {
      audits: { orderBy: { createdAt: "desc" }, take: 1 },
      signalSets: { orderBy: { createdAt: "desc" }, take: 1 },
      opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
      drafts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const kind = classifyEvaluation({
    verdict: lead?.audits[0]?.verdict ?? null,
    outcome: parsed,
  });
  if (kind && lead) {
    await prisma.evaluationExample.create({
      data: {
        leadId: lead.id,
        kind,
        traceId: trace?.id ?? null,
        features: {
          signals: lead.signalSets[0]?.payload ?? null,
          opportunity: lead.opportunities[0]
            ? {
                problem: lead.opportunities[0].problem,
                service: lead.opportunities[0].recommendedService,
                confidence: lead.opportunities[0].confidence,
                score: lead.opportunities[0].score,
              }
            : null,
          decision: lead.audits[0]
            ? { verdict: lead.audits[0].verdict, summary: lead.audits[0].summary, score: lead.audits[0].score }
            : null,
          action: lead.drafts[0]
            ? { channel: lead.drafts[0].channel, status: lead.drafts[0].status, decisionId: lead.drafts[0].decisionId }
            : null,
        } as Prisma.InputJsonValue,
        outcome: parsed as unknown as Prisma.InputJsonValue,
      },
    });
  }
  await rememberTrace({
    leadId: input.leadId,
    publicLeadId: lead?.leadId,
    kind: "outcome",
    content: `Outcome ${parsed.status}`,
    traceId: trace?.id,
  });
  return row;
}

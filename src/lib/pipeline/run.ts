import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { getAgent } from "@/lib/agents/registry";
import { readSuppressionState, writeAudit } from "@/lib/db/settings";
import { enrollSequence } from "@/lib/outreach/sequence";
import { patchTrace, startTrace } from "@/lib/intelligence/trace";
import { AGENT_DEFINITIONS } from "@/lib/agents/types";
import { PIPELINE_STEPS } from "@/lib/pipeline/steps";
import type { OutreachStrategy } from "@/types";

export async function runLeadPipeline(leadId: string, payload: Record<string, unknown> = {}) {
  const steps = PIPELINE_STEPS;
  const results: Record<string, unknown> = {};
  let strategy: OutreachStrategy | undefined;
  let haltReason: string | null = null;
  let skipWriter = false;
  const trace = await startTrace(leadId);
  await Promise.all(
    PIPELINE_STEPS.map((slug) => {
      const def = AGENT_DEFINITIONS.find((item) => item.slug === slug);
      if (!def) return null;
      return prisma.agent.upsert({
        where: { slug },
        update: {},
        create: { slug: def.slug, name: def.name, description: def.description },
      });
    }),
  );

  for (const slug of steps) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error("Lead not found");
    if (lead.status === "DO_NOT_CONTACT" || lead.suppressed) {
      results[slug] = { skipped: true, reason: "do-not-contact" };
      continue;
    }
    if (haltReason) {
      results[slug] = { skipped: true, reason: haltReason };
      continue;
    }
    if (skipWriter && slug === "outreach_writer") {
      results[slug] = { skipped: true, reason: "decision maker hold — no draft until the audit is complete" };
      continue;
    }

    const [prompt, agentRow] = await Promise.all([
      prisma.prompt.findUnique({ where: { agentSlug: slug } }),
      prisma.agent.findUnique({ where: { slug } }),
    ]);
    const run = agentRow
      ? await prisma.agentRun.create({
          data: {
            agentId: agentRow.id,
            leadId,
            input: { pipeline: true, traceId: trace.id, ...payload } as Prisma.InputJsonValue,
            status: "RUNNING",
            startedAt: new Date(),
            promptVersion: prompt?.version ?? 1,
            traceId: trace.id,
          },
        })
      : null;
    try {
      const result = await getAgent(slug).execute({
        lead,
        prompt: prompt?.content ?? "",
        payload: {
          ...payload,
          strategy,
          channel: payload.channel,
          traceId: trace.id,
        },
      });
      results[slug] = {
        ok: result.ok,
        mode: result.mode,
        error: result.error,
        promptVersion: result.promptVersion ?? prompt?.version ?? 1,
        modelProvider: result.modelProvider ?? null,
      };
      if (run) {
        await prisma.agentRun.update({
          where: { id: run.id },
          data: {
            status: result.ok ? "COMPLETED" : "FAILED",
            output: (result.output ?? results[slug]) as Prisma.InputJsonValue,
            error: result.error,
            endedAt: new Date(),
            modelProvider: result.modelProvider ?? null,
            promptVersion: result.promptVersion ?? prompt?.version ?? 1,
          },
        });
        await patchTrace(trace.id, { agentRunId: run.id });
      }
      if (slug === "decision_maker" && result.ok) {
        const output = (result.output ?? {}) as { verdict?: string; allowedChannels?: string[] };
        if (Array.isArray(output.allowedChannels)) payload.allowedChannels = output.allowedChannels;
        if (output.verdict === "REJECT") haltReason = "decision maker rejected the lead";
        if (output.verdict === "HOLD") skipWriter = true;
        await writeAudit({
          action: output.verdict === "PASS" ? "decision.evaluated" : "lead.blocked",
          entity: "lead",
          entityId: leadId,
          payload: { verdict: output.verdict ?? "unknown", stage: "decision_maker", traceId: trace.id },
        });
      }
      if (slug === "research" && result.ok) {
        await writeAudit({ action: "lead.enriched", entity: "lead", entityId: leadId, payload: { traceId: trace.id } });
      }
      if (typeof payload.stopAfter === "string" && payload.stopAfter === slug) {
        break;
      }
      if (slug === "strategist" && result.ok) {
        strategy = result.output as OutreachStrategy;
        if (strategy && strategy.shouldContactNow === false) {
          results.outreach_writer = { skipped: true, reason: "strategist deferred contact" };
          break;
        }
      }
      if (!result.ok) {
        results[slug] = { ok: false, error: result.error };
      } else if (slug === "outreach_writer") {
        const output = (result.output ?? {}) as { draftId?: string; skipped?: boolean };
        if (output.draftId && !output.skipped) {
          const [current, draft] = await Promise.all([
            prisma.lead.findUnique({
              where: { id: leadId },
              include: { audits: { orderBy: { createdAt: "desc" }, take: 1 } },
            }),
            prisma.outreachDraft.findUnique({ where: { id: output.draftId } }),
          ]);
          if (current && draft && !output.skipped) {
            const suppression = await readSuppressionState({
              email: current.email,
              websiteHost: current.websiteHost,
              phone: current.phone,
            });
            await enrollSequence({
              leadId: current.id,
              channel: draft.channel,
              auditVerdict: current.audits[0]?.verdict ?? null,
              auditedAt: current.audits[0]?.createdAt ?? null,
              leadStatus: current.status,
              suppressed: current.suppressed || suppression === "suppressed",
              unsubscribed: suppression === "suppressed",
              suppressionUnknown: suppression === "unknown",
              draftId: draft.id,
            });
          }
        }
      }
    } catch (error) {
      results[slug] = {
        ok: false,
        error: error instanceof Error ? error.message : "step failed",
      };
      if (run) {
        await prisma.agentRun.update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            error: error instanceof Error ? error.message : "step failed",
            endedAt: new Date(),
          },
        });
      }
    }
  }

  return { leadId, traceId: trace.id, results };
}

export const AUTHORITATIVE_PIPELINE = "runLeadPipeline";

import "server-only";

import type { Prisma, TaskStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { getAgent } from "@/lib/agents/registry";
import { runLeadPipeline } from "@/lib/pipeline/run";
import { importFromConfiguredSheet, exportEnrichedSheet } from "@/lib/google/sync";

export type TaskType =
  | "PIPELINE_LEAD"
  | "RESEARCH_LEAD"
  | "QUALIFY_LEAD"
  | "AUDIT_LEAD"
  | "SIGNALS_LEAD"
  | "OPPORTUNITY_LEAD"
  | "STRATEGY_LEAD"
  | "WRITE_OUTREACH"
  | "FOLLOW_UP_LEAD"
  | "IMPORT_SHEET"
  | "EXPORT_SHEET"
  | "RUN_AGENT"
  | "RUN_CAMPAIGN"
  | "SYNC_CAMPAIGN_RUN"
  | "SYNC_ACTOR_RUN"
  | "RUN_APIFY_ACTOR"
  | "RUN_APIFY_ACTORS"
  | "BROWSER_TASK"
  | "RUN_OUTREACH_ENGINE"
  | "PROCESS_SEQUENCES"
  | "DISCOVER_PROSPECTS"
  | "ENRICH_LEADS";

const AGENT_FOR_TYPE: Record<string, string> = {
  RESEARCH_LEAD: "research",
  QUALIFY_LEAD: "qualification",
  SIGNALS_LEAD: "signals",
  AUDIT_LEAD: "decision_maker",
  OPPORTUNITY_LEAD: "opportunity",
  STRATEGY_LEAD: "strategist",
  WRITE_OUTREACH: "outreach_writer",
  FOLLOW_UP_LEAD: "follow_up",
  PIPELINE_LEAD: "orchestrator",
  IMPORT_SHEET: "intake",
  EXPORT_SHEET: "intake",
  RUN_AGENT: "orchestrator",
  BROWSER_TASK: "browser",
};

export async function enqueue(input: {
  type: TaskType;
  payload?: Record<string, unknown>;
  leadId?: string | null;
  maxRetries?: number;
  timeoutMs?: number;
}) {
  const agentSlug = (input.payload?.agentSlug as string | undefined) ?? AGENT_FOR_TYPE[input.type];
  const agent = agentSlug
    ? await prisma.agent.findUnique({ where: { slug: agentSlug } })
    : null;

  return prisma.task.create({
    data: {
      type: input.type,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      leadId: input.leadId ?? null,
      agentId: agent?.id ?? null,
      maxRetries: input.maxRetries ?? 2,
      timeoutMs: input.timeoutMs ?? 90_000,
      status: "QUEUED",
    },
  });
}

export async function processQueue(limit = 5) {
  const tasks = await prisma.task.findMany({
    where: {
      status: { in: ["QUEUED", "RETRYING"] },
      availableAt: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return processQueueParallel(
    tasks.map((task) => task.id),
    Math.min(4, limit),
  );
}

export async function processQueueParallel(taskIds: string[], concurrency = 4) {
  const results: Awaited<ReturnType<typeof runTask>>[] = [];
  const unique = [...new Set(taskIds)];
  for (let index = 0; index < unique.length; index += concurrency) {
    const batch = unique.slice(index, index + concurrency);
    const settled = await Promise.allSettled(batch.map((id) => runTask(id)));
    for (const item of settled) {
      if (item.status === "fulfilled") results.push(item.value);
      else {
        results.push({
          id: "unknown",
          status: "FAILED",
          error: item.reason instanceof Error ? item.reason.message : "Task failed",
        });
      }
    }
  }
  return results;
}

export async function cancelQueuedTasks(taskIds?: string[]) {
  return prisma.task.updateMany({
    where: {
      status: { in: ["QUEUED", "RETRYING"] },
      ...(taskIds?.length ? { id: { in: taskIds } } : {}),
    },
    data: { status: "CANCELLED", completedAt: new Date(), error: "Cancelled by operator" },
  });
}

export async function runTask(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Task not found");
  if (task.status === "CANCELLED") {
    return { id: taskId, status: "CANCELLED" as TaskStatus };
  }
  if (task.status === "COMPLETED") {
    return { id: taskId, status: "COMPLETED" as TaskStatus, output: task.result };
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      startedAt: new Date(),
    },
  });

  if (task.agentId) {
    await prisma.agent.update({
      where: { id: task.agentId },
      data: { status: "RUNNING", currentTask: task.type, lastError: null },
    });
  }

  const run = await prisma.agentRun.create({
    data: {
      agentId: task.agentId ?? (await ensureOrchestratorId()),
      leadId: task.leadId,
      taskId: task.id,
      input: task.payload as Prisma.InputJsonValue,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  try {
    const output = await withTimeout(() => executeTask(task), task.timeoutMs);
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        result: output as Prisma.InputJsonValue,
        completedAt: new Date(),
        runId: run.id,
        error: null,
      },
    });
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        output: output as Prisma.InputJsonValue,
        endedAt: new Date(),
      },
    });
    if (task.agentId) {
      await prisma.agent.update({
        where: { id: task.agentId },
        data: {
          status: "IDLE",
          currentTask: null,
          lastRunAt: new Date(),
          tasksDone: { increment: 1 },
        },
      });
    }
    return { id: taskId, status: "COMPLETED" as TaskStatus, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task failed";
    const timedOut = message.includes("timed out");
    const attempts = task.attempts + 1;
    const retry = attempts <= task.maxRetries && !timedOut;
    const status: TaskStatus = retry ? "RETRYING" : "FAILED";

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status,
        error: message,
        availableAt: retry ? new Date(Date.now() + attempts * 15_000) : undefined,
        completedAt: retry ? null : new Date(),
        runId: run.id,
      },
    });
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: timedOut ? "TIMEOUT" : "FAILED",
        error: message,
        endedAt: new Date(),
      },
    });
    if (task.agentId) {
      await prisma.agent.update({
        where: { id: task.agentId },
        data: {
          status: retry ? "IDLE" : "ERROR",
          currentTask: null,
          lastError: message,
          lastRunAt: new Date(),
          errorCount: { increment: 1 },
        },
      });
    }
    return { id: taskId, status, error: message };
  }
}

async function executeTask(task: {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  leadId: string | null;
}) {
  const payload = {
    ...((task.payload ?? {}) as Record<string, unknown>),
    taskId: task.id,
  } as Record<string, unknown>;

  if (task.type === "IMPORT_SHEET") return importFromConfiguredSheet();
  if (task.type === "EXPORT_SHEET") return exportEnrichedSheet();
  if (task.type === "PIPELINE_LEAD") {
    if (!task.leadId) throw new Error("PIPELINE_LEAD requires leadId");
    return runLeadPipeline(task.leadId, payload);
  }
  if (task.type === "RUN_OUTREACH_ENGINE") {
    const { runOutreachEngine } = await import("@/lib/outreach/engine");
    return runOutreachEngine({
      limit: typeof payload.limit === "number" ? payload.limit : 10,
      importSheet: Boolean(payload.importSheet),
      command: typeof payload.command === "string" ? payload.command : "",
    });
  }
  if (task.type === "PROCESS_SEQUENCES") {
    const { tickDueSequenceSteps } = await import("@/lib/outreach/engine");
    return tickDueSequenceSteps();
  }
  if (task.type === "DISCOVER_PROSPECTS") {
    const { discoverProspects } = await import("@/lib/discovery/search");
    return discoverProspects({
      dryRun: payload.dryRun === true,
      limit: typeof payload.limit === "number" ? payload.limit : undefined,
    });
  }
  if (task.type === "ENRICH_LEADS") {
    const { identifyMissingLinkedIn } = await import("@/lib/enrichment/identify");
    return identifyMissingLinkedIn({
      dryRun: payload.dryRun === true,
      limit: typeof payload.limit === "number" ? payload.limit : undefined,
    });
  }
  if (task.type === "RUN_CAMPAIGN") {
    const { startCampaignRun } = await import("@/lib/campaigns/runner");
    return startCampaignRun(String(payload.campaignId), Boolean(payload.testMode));
  }
  if (task.type === "SYNC_CAMPAIGN_RUN") {
    const { syncCampaignRun } = await import("@/lib/campaigns/runner");
    return syncCampaignRun(String(payload.campaignRunId));
  }
  if (task.type === "SYNC_ACTOR_RUN") {
    const { syncStandaloneActorRun } = await import("@/lib/campaigns/runner");
    return syncStandaloneActorRun(String(payload.actorRunId));
  }
  if (task.type === "RUN_APIFY_ACTOR") {
    const { runConfiguredActorJob } = await import("@/lib/apify/job");
    return runConfiguredActorJob({
      apifyActorId: String(payload.apifyActorId ?? payload.actorId ?? ""),
      testMode: payload.testMode !== false,
      ingest: payload.ingest !== false,
      pipeline: Boolean(payload.pipeline),
      limit: typeof payload.limit === "number" ? payload.limit : undefined,
    });
  }
  if (task.type === "RUN_APIFY_ACTORS") {
    const { runConfiguredActorsJob } = await import("@/lib/apify/job");
    return runConfiguredActorsJob({
      actorIds: Array.isArray(payload.actorIds) ? payload.actorIds.map(String) : undefined,
      actorQuery: typeof payload.actorQuery === "string" ? payload.actorQuery : null,
      testMode: payload.testMode !== false,
      ingest: payload.ingest !== false,
      pipeline: Boolean(payload.pipeline),
      limit: typeof payload.limit === "number" ? payload.limit : undefined,
    });
  }

  const slug =
    task.type === "RUN_AGENT"
      ? String(payload.agentSlug ?? "")
      : AGENT_FOR_TYPE[task.type];
  if (!slug || slug === "orchestrator") {
    throw new Error(`No specialized agent for task ${task.type}`);
  }

  const lead = task.leadId
    ? await prisma.lead.findUnique({ where: { id: task.leadId } })
    : null;
  if (task.leadId && !lead) throw new Error("Lead not found");

  const prompt = await prisma.prompt.findUnique({ where: { agentSlug: slug } });
  const agent = getAgent(slug);
  const result = await agent.execute({
    lead: lead ?? undefined,
    payload,
    prompt: prompt?.content ?? "",
  });
  if (!result.ok) throw new Error(result.error || `${slug} failed`);
  if (task.type === "RESEARCH_LEAD" && lead) {
    const linkedinPrompt = await prisma.prompt.findUnique({ where: { agentSlug: "linkedin_research" } });
    const linkedin = await getAgent("linkedin_research").execute({
      lead,
      payload,
      prompt: linkedinPrompt?.content ?? "",
    });
    if (!linkedin.ok) throw new Error(linkedin.error || "linkedin_research failed");
    const instagramPrompt = await prisma.prompt.findUnique({ where: { agentSlug: "instagram_research" } });
    const instagram = await getAgent("instagram_research").execute({
      lead,
      payload,
      prompt: instagramPrompt?.content ?? "",
    });
    if (!instagram.ok) throw new Error(instagram.error || "instagram_research failed");
    return { website: result, linkedin, instagram };
  }
  return result;
}

async function ensureOrchestratorId() {
  const agent = await prisma.agent.upsert({
    where: { slug: "orchestrator" },
    update: {},
    create: {
      slug: "orchestrator",
      name: "Orchestrator Agent",
      description: "Coordinates specialized agents.",
    },
  });
  return agent.id;
}

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

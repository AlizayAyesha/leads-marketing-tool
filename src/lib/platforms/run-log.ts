import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { AGENT_DEFINITIONS } from "@/lib/agents/types";
import type { PlatformAgent, PlatformAgentResult, PlatformTask } from "@/lib/platforms/types";

export async function recordPlatformAgentRun(
  slug: string,
  task: PlatformTask,
  result: PlatformAgentResult,
) {
  const def = AGENT_DEFINITIONS.find((item) => item.slug === slug);
  const agent = await prisma.agent.upsert({
    where: { slug },
    update: {},
    create: {
      slug,
      name: def?.name ?? slug,
      description: def?.description ?? slug,
    },
  });
  const ok = result.ok;
  await prisma.agentRun.create({
    data: {
      agentId: agent.id,
      input: { type: task.type, payload: task.payload ?? {} } as Prisma.InputJsonValue,
      output: (result.output ?? null) as Prisma.InputJsonValue,
      status: ok ? "COMPLETED" : "FAILED",
      error: result.error,
      startedAt: new Date(),
      endedAt: new Date(),
    },
  });
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      lastRunAt: new Date(),
      lastError: ok ? null : result.error ?? "failed",
      status: "IDLE",
      currentTask: null,
      tasksDone: { increment: ok ? 1 : 0 },
      errorCount: { increment: ok ? 0 : 1 },
    },
  });
}

export function withPlatformRunLogging(agent: PlatformAgent): PlatformAgent {
  return {
    id: agent.id,
    name: agent.name,
    platform: agent.platform,
    capabilities: agent.capabilities,
    permissions: agent.permissions,
    async execute(task: PlatformTask) {
      const result = await agent.execute(task);
      try {
        await recordPlatformAgentRun(agent.id, task, result);
      } catch {
        // Control-center logging must not fail the Fiverr workflow.
      }
      return result;
    },
  };
}

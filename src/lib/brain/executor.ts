import "server-only";

import { prisma } from "@/lib/db/prisma";
import { getPlatformAgent } from "@/lib/platforms/registry";
import { platformPerformance, unansweredOpportunities, topOpportunities } from "@/lib/platforms/analytics";
import { emitBrainEvent } from "@/lib/brain/events";
import type { PlannedTask } from "@/lib/brain/planner";

export async function executePlan(tasks: PlannedTask[]) {
  const groups = new Map<number, PlannedTask[]>();
  for (const task of tasks) {
    const list = groups.get(task.parallelGroup) ?? [];
    list.push(task);
    groups.set(task.parallelGroup, list);
  }

  const results = [];
  for (const group of [...groups.keys()].sort((a, b) => a - b)) {
    const batch = groups.get(group) ?? [];
    const settled = await Promise.allSettled(batch.map((task) => runOne(task)));
    for (const item of settled) {
      if (item.status === "fulfilled") results.push(item.value);
      else {
        results.push({
          ok: false,
          agentId: "unknown",
          error: item.reason instanceof Error ? item.reason.message : "Task failed",
          output: null,
        });
      }
    }
  }
  await emitBrainEvent("plan.executed", { count: results.length });
  return results;
}

async function runOne(task: PlannedTask) {
  if (task.agentId === "analytics") {
    if (task.type === "compare_freelance_platforms") {
      return { ok: true, agentId: "analytics", output: await platformPerformance() };
    }
    if (task.type === "list_unanswered_opportunities") {
      return { ok: true, agentId: "analytics", output: await unansweredOpportunities() };
    }
    return { ok: true, agentId: "analytics", output: await topOpportunities() };
  }

  if (task.type === "prepare_best") {
    const best = await prisma.freelanceOpportunity.findMany({
      where: {
        platform: "UPWORK",
        classification: { in: ["EXCELLENT", "GOOD"] },
        status: { in: ["NEW", "QUALIFIED", "RESEARCHED"] },
      },
      orderBy: { fitScore: "desc" },
      take: 3,
    });
    const agent = getPlatformAgent("upwork_proposal");
    const outputs = [];
    for (const row of best) {
      outputs.push(await agent.execute({ type: "prepare", payload: { opportunityId: row.id } }));
    }
    return { ok: true, agentId: agent.id, output: { prepared: outputs.length, items: outputs } };
  }

  if (task.type === "draft_open") {
    const open = await prisma.buyerInquiry.findMany({
      where: { status: { in: ["NEW", "QUALIFIED"] } },
      take: 8,
      include: { opportunity: true },
    });
    const agent = getPlatformAgent("fiverr_response");
    const outputs = [];
    for (const row of open) {
      outputs.push(await agent.execute({ type: "draft", payload: { inquiryId: row.id } }));
    }
    return { ok: true, agentId: agent.id, output: { drafted: outputs.length, items: outputs } };
  }

  const agent = getPlatformAgent(task.agentId);
  const result = await agent.execute({ type: task.type, payload: task.payload });
  return { ok: result.ok, agentId: agent.id, output: result.output, error: result.error };
}

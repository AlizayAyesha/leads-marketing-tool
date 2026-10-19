import "server-only";

import { matchFreelanceCommand } from "@/lib/brain/capabilities";
import { planFreelanceWork } from "@/lib/brain/planner";
import { executePlan } from "@/lib/brain/executor";
import { emitBrainEvent } from "@/lib/brain/events";
import type { JarvisCommandResult } from "@/types";

export async function triageFreelanceCommand(command: string): Promise<JarvisCommandResult> {
  const match = matchFreelanceCommand(command);
  if (!match) {
    return {
      intent: "UNKNOWN",
      summary: "That command did not map to a freelance capability.",
      taskIds: [],
      leadIds: [],
    };
  }
  const plan = planFreelanceWork(match);
  await emitBrainEvent("triage.plan", { command, capability: match.capability, tasks: plan.length });
  const results = await executePlan(plan);
  return {
    intent: match.capability,
    summary: summarize(match.capability, results),
    taskIds: plan.map((task) => task.id),
    leadIds: [],
    data: { plan, results },
  };
}

function summarize(capability: string, results: { ok: boolean; error?: string }[]) {
  const failed = results.filter((item) => !item.ok).length;
  if (capability === "compare_freelance_platforms") {
    return "Compared stored Upwork and Fiverr history. No forecast is made without enough samples.";
  }
  if (capability === "find_freelance_opportunities") {
    return "Searched stored freelance opportunities. Official marketplace APIs are not connected, so live search is marked unavailable.";
  }
  return `Triage finished ${results.length} task(s)${failed ? `, ${failed} failed` : ""}.`;
}

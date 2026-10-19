"use server";

import { interpretCommand } from "@/lib/agents/orchestrator";

export async function runJarvisCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed) return { intent: "UNKNOWN", summary: "Enter a command.", taskIds: [], leadIds: [] };
  return interpretCommand(trimmed);
}

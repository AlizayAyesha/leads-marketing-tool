import "server-only";

import { ApifyTool } from "@/lib/tools/apify";
import { ChromeTool } from "@/lib/tools/chrome-platform";
import { FiverrTool } from "@/lib/tools/fiverr";
import { UpworkTool } from "@/lib/tools/upwork";
import type { PlatformTool } from "@/lib/tools/types";

const tools: PlatformTool[] = [new ApifyTool(), new ChromeTool(), new UpworkTool(), new FiverrTool()];

export function getTool(id: string) {
  const tool = tools.find((item) => item.id === id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  return tool;
}

export function listTools() {
  return tools.map((tool) => ({ id: tool.id, platform: tool.platform }));
}

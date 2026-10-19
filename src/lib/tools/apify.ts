import "server-only";

import { ApifyService } from "@/lib/apify/service";
import { getApifyToken } from "@/lib/secrets";
import { runActor, type ApifyActorRunResult } from "@/lib/apify/tool";
import type { PlatformTool, ToolAvailability, ToolResult } from "@/lib/tools/types";

export class ApifyTool implements PlatformTool {
  readonly id = "apify";
  readonly platform = "apify";

  async availability(): Promise<ToolAvailability> {
    const token = await getApifyToken();
    if (!token.token) {
      return {
        available: false,
        reason: "Apify is not connected. Set APIFY_TOKEN or save a token in Integrations → API Keys.",
      };
    }
    return { available: true, reason: "Apify Actor tool is available. It does not score or send." };
  }

  async runActor(input: {
    actorId: string;
    runInput?: Record<string, unknown>;
    testMode?: boolean;
    itemLimit?: number;
  }): Promise<ToolResult<ApifyActorRunResult>> {
    const token = await getApifyToken();
    const service = new ApifyService();
    const result = await runActor(input, {
      configured: Boolean(token.token),
      startRun: (payload) => service.startRun(payload),
      getDatasetItems: (datasetId, limit) => service.getDatasetItems(datasetId, limit),
    });
    return {
      ok: result.status === "SUCCEEDED",
      available: Boolean(token.token),
      data: result,
      error: result.error ?? undefined,
    };
  }
}

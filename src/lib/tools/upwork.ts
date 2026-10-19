import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { PlatformTool, ToolAvailability, ToolResult } from "@/lib/tools/types";

const UNAVAILABLE =
  "Official Upwork API is not connected. Jarvis will not invent a private/unofficial endpoint. Import a listing manually or connect a supported integration later.";

export class UpworkTool implements PlatformTool {
  readonly id = "upwork";
  readonly platform = "upwork";

  async availability(): Promise<ToolAvailability> {
    const connection = await prisma.platformConnection.findUnique({
      where: { platform: "upwork" },
    });
    if (connection?.status === "CONNECTED") {
      return {
        available: false,
        reason:
          "A connection row exists, but no official Upwork API adapter is wired. External search/submit stays unavailable.",
      };
    }
    return { available: false, reason: UNAVAILABLE };
  }

  async searchOpportunities(): Promise<ToolResult<never>> {
    const availability = await this.availability();
    return { ok: false, available: false, error: availability.reason };
  }

  async submitProposal(): Promise<ToolResult<never>> {
    return {
      ok: false,
      available: false,
      error:
        "External Upwork submission is not enabled. Drafts stay in AWAITING_APPROVAL until a supported official integration exists.",
    };
  }
}

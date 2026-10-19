import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { PlatformTool, ToolAvailability, ToolResult } from "@/lib/tools/types";

const UNAVAILABLE =
  "Official Fiverr API is not connected. Jarvis will not invent an unofficial seller API. Import gig or inquiry text manually.";

export class FiverrTool implements PlatformTool {
  readonly id = "fiverr";
  readonly platform = "fiverr";

  async availability(): Promise<ToolAvailability> {
    const connection = await prisma.platformConnection.findUnique({
      where: { platform: "fiverr" },
    });
    if (connection?.status === "CONNECTED") {
      return {
        available: false,
        reason:
          "A connection row exists, but no official Fiverr API adapter is wired. External sync/send stays unavailable.",
      };
    }
    return { available: false, reason: UNAVAILABLE };
  }

  async listGigs(): Promise<ToolResult<never>> {
    const availability = await this.availability();
    return { ok: false, available: false, error: availability.reason };
  }

  async submitResponse(): Promise<ToolResult<never>> {
    return {
      ok: false,
      available: false,
      error:
        "External Fiverr replies are not enabled. Drafts stay in AWAITING_APPROVAL until a supported official integration exists.",
    };
  }
}

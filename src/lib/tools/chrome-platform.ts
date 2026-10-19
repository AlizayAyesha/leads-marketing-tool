import type { PlatformTool, ToolAvailability, ToolResult } from "@/lib/tools/types";
import { getChromeSession, performBrowserCommand } from "@/lib/tools/chrome";
import type { BrowserCommand, BrowserToolResult } from "@/lib/browser/types";

export class ChromeTool implements PlatformTool {
  readonly id = "chrome";
  readonly platform = "browser";

  async availability(): Promise<ToolAvailability> {
    const session = getChromeSession();
    return {
      available: session.status === "CONNECTED",
      reason:
        session.status === "CONNECTED"
          ? "Jarvis Chrome session is connected."
          : session.lastError || "Jarvis Chrome is DISCONNECTED.",
    };
  }

  async perform(command: BrowserCommand): Promise<ToolResult<BrowserToolResult>> {
    const result = await performBrowserCommand(command);
    return {
      ok: result.ok,
      available: getChromeSession().status === "CONNECTED",
      data: result,
      error: result.error,
    };
  }
}

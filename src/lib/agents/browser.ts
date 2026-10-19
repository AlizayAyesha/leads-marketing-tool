import "server-only";

import { BaseAgent } from "@/lib/agents/base";
import type { AgentContext, AgentResult } from "@/lib/agents/types";
import { performBrowserCommand } from "@/lib/tools/chrome";
import type { BrowserAction, BrowserCommand } from "@/lib/browser/types";

const ACTIONS = new Set<BrowserAction>([
  "navigate",
  "back",
  "forward",
  "reload",
  "open_tab",
  "close_tab",
  "switch_tab",
  "click",
  "type",
  "select",
  "scroll",
  "hover",
  "keyboard",
  "read",
  "extract_table",
  "extract_links",
  "extract_forms",
  "screenshot",
  "download",
  "upload",
  "form_fill",
  "form_submit",
  "message_prepare",
  "message_send",
  "proposal_submit",
  "publish",
  "purchase",
  "delete",
  "security_change",
  "sheet_read",
  "sheet_write_enrichment",
  "sheet_write_original",
]);

export class BrowserAgent extends BaseAgent {
  slug = "browser";
  name = "Browser Agent";
  description = "Operates Jarvis Chrome. Does not score leads, choose offers, or approve outreach.";

  async execute(ctx: AgentContext): Promise<AgentResult> {
    const payload = ctx.payload ?? {};
    const action = String(payload.action ?? "navigate") as BrowserAction;
    if (!ACTIONS.has(action)) {
      return { ok: false, mode: "heuristic", output: null, error: `Unknown browser action: ${action}` };
    }

    const command: BrowserCommand = {
      action,
      url: (payload.url as string | undefined) ?? ctx.lead?.website ?? null,
      selector: (payload.selector as string | undefined) ?? null,
      text: (payload.text as string | undefined) ?? null,
      value: (payload.value as string | undefined) ?? null,
      spreadsheetId: (payload.spreadsheetId as string | undefined) ?? null,
      worksheet: (payload.worksheet as string | undefined) ?? null,
      simulate: Boolean(payload.simulate),
      approvalStatus: (payload.approvalStatus as string | undefined) ?? null,
      taskId: (payload.taskId as string | undefined) ?? null,
      agentRunId: (payload.agentRunId as string | undefined) ?? null,
      leadId: ctx.lead?.id ?? null,
    };

    const result = await performBrowserCommand(command);
    return {
      ok: result.ok,
      mode: "heuristic",
      output: {
        tool: "chrome",
        intelligence: "none",
        state: result.state,
        evidence: result.evidence,
        trace: result.trace,
      },
      error: result.error,
    };
  }
}

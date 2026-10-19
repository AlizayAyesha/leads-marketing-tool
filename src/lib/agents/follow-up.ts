import "server-only";

import { prisma } from "@/lib/db/prisma";
import { DEFAULT_PROMPTS } from "@/lib/prompts/defaults";
import { BaseAgent } from "@/lib/agents/base";
import { asLeadRecord, type AgentContext, type AgentResult } from "@/lib/agents/types";
import { canEnterOutreach } from "@/lib/outreach/gate";
import { writeAudit } from "@/lib/db/settings";

export class FollowUpAgent extends BaseAgent {
  slug = "follow_up";
  name = "Follow-Up Agent";
  description = "Suggests follow-ups from status. Does not send. Never bypasses Decision Maker.";

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.lead) return { ok: false, mode: "heuristic", output: null, error: "Lead is required" };

    const [draft, audit, sequence] = await Promise.all([
      prisma.outreachDraft.findFirst({
        where: { leadId: ctx.lead.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.leadAudit.findFirst({
        where: { leadId: ctx.lead.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.outreachSequence.findFirst({
        where: { leadId: ctx.lead.id, status: { in: ["ACTIVE", "PAUSED"] } },
      }),
    ]);

    const eligibility = canEnterOutreach({
      verdict: audit?.verdict,
      auditedAt: audit?.createdAt,
      suppressed: ctx.lead.suppressed,
      unsubscribed: false,
      leadStatus: ctx.lead.status,
      sequenceStopReason: sequence?.stopReason,
      purpose: "follow_up",
    });

    const heuristic = {
      shouldFollowUp: false,
      delayDays: 4,
      channel: draft?.channel ?? null,
      suggestion: eligibility.ok
        ? "Sequence engine owns Day 0/3/7/14 follow-ups. This agent does not create extra drafts."
        : eligibility.reason,
      draft: null as string | null,
      skipReason: eligibility.ok
        ? sequence
          ? "Active sequence already owns follow-ups."
          : ctx.lead.status === "CONTACTED"
            ? "Use the outreach sequence instead of a parallel follow-up draft."
            : `Status is ${ctx.lead.status}`
        : eligibility.reason,
    };

    if (!eligibility.ok) {
      await writeAudit({
        action: "outreach.followup.blocked",
        entity: "lead",
        entityId: ctx.lead.id,
        payload: { code: eligibility.code, reason: eligibility.reason },
      });
      return { ok: true, mode: "heuristic", output: heuristic };
    }

    const ai = await this.askJson<typeof heuristic>(
      ctx.prompt || DEFAULT_PROMPTS.follow_up.content,
      JSON.stringify({ lead: asLeadRecord(ctx.lead), draft, heuristic }),
    );
    const result = { ...(ai.data ?? heuristic), shouldFollowUp: false, draft: null };

    return {
      ok: true,
      mode: ai.data ? "openai" : "heuristic",
      output: result,
    };
  }
}

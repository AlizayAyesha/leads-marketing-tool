import "server-only";

import type { OutreachChannel } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { DEFAULT_PROMPTS } from "@/lib/prompts/defaults";
import { BaseAgent } from "@/lib/agents/base";
import { asLeadRecord, type AgentContext, type AgentResult } from "@/lib/agents/types";
import type { OutreachStrategy } from "@/types";

export class StrategistAgent extends BaseAgent {
  slug = "strategist";
  name = "Marketing Strategist Agent";
  description = "Chooses channel, tone, timing, and constraints.";

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.lead) return { ok: false, mode: "heuristic", output: null, error: "Lead is required" };

    const opportunity = await prisma.opportunity.findFirst({
      where: { leadId: ctx.lead.id },
      orderBy: { createdAt: "desc" },
    });
    const score = await prisma.leadScore.findFirst({
      where: { leadId: ctx.lead.id },
      orderBy: { createdAt: "desc" },
    });
    const audit = await prisma.leadAudit.findFirst({
      where: { leadId: ctx.lead.id },
      orderBy: { createdAt: "desc" },
    });
    const allowed = Array.isArray(ctx.payload?.allowedChannels)
      ? (ctx.payload.allowedChannels as OutreachChannel[])
      : ((audit?.allowedChannels as OutreachChannel[] | undefined) ?? []);
    const heuristic = heuristicStrategy(
      ctx.lead,
      opportunity?.recommendedService ?? null,
      score?.temperature ?? null,
      allowed,
      audit?.verdict ?? null,
    );
    const ai = await this.askJson<OutreachStrategy>(
      ctx.prompt || DEFAULT_PROMPTS.strategist.content,
      JSON.stringify({
        lead: asLeadRecord(ctx.lead),
        opportunity,
        score,
        heuristic,
      }),
    );

    const result = ai.data
      ? {
          ...heuristic,
          ...ai.data,
          channel: isChannel(ai.data.channel) ? ai.data.channel : heuristic.channel,
        }
      : heuristic;
    if (allowed.length && !allowed.includes(result.channel)) {
      result.channel = allowed[0];
    }

    if (ctx.lead.suppressed || ctx.lead.status === "DO_NOT_CONTACT") {
      result.shouldContactNow = false;
      result.reasonForContacting = "Lead is suppressed or marked do-not-contact.";
    }
    const breakdown = (score?.breakdown ?? {}) as { decision?: string };
    if (
      breakdown.decision === "SKIP" ||
      breakdown.decision === "INSUFFICIENT_EVIDENCE" ||
      breakdown.decision === "INVALID" ||
      score?.temperature === "DISQUALIFIED"
    ) {
      result.shouldContactNow = false;
      result.reasonForContacting = `Decision ${breakdown.decision ?? score?.temperature}: do not request approval.`;
    }

    if (audit?.verdict === "REJECT" || audit?.verdict === "HOLD") {
      result.shouldContactNow = false;
      result.reasonForContacting =
        audit.verdict === "REJECT"
          ? "Decision maker rejected this lead. Do not request approval."
          : "Decision maker held this lead until email/LinkedIn/Instagram evidence is complete.";
    }

    return {
      ok: true,
      mode: ai.data ? "openai" : "heuristic",
      output: result,
      error: ai.data ? undefined : ai.error,
    };
  }
}

function heuristicStrategy(
  lead: NonNullable<AgentContext["lead"]>,
  service: string | null,
  temperature: string | null,
  allowedChannels: OutreachChannel[] = [],
  auditVerdict: string | null = null,
): OutreachStrategy {
  const preferred: OutreachChannel = allowedChannels[0]
    ? allowedChannels[0]
    : lead.email
      ? "EMAIL"
      : lead.linkedinUrl
        ? "LINKEDIN"
        : lead.instagramUrl
          ? "INSTAGRAM"
          : lead.facebookUrl
            ? "FACEBOOK"
            : lead.twitterUrl
              ? "X_TWITTER"
              : "EMAIL";

  const channel: OutreachChannel =
    allowedChannels.length && !allowedChannels.includes(preferred) ? allowedChannels[0] : preferred;

  const contactable = Boolean(
    allowedChannels.length
      ? allowedChannels.includes(channel)
      : (channel === "EMAIL" && lead.email) ||
          (channel === "LINKEDIN" && lead.linkedinUrl) ||
          (channel === "INSTAGRAM" && lead.instagramUrl) ||
          (channel === "FACEBOOK" && lead.facebookUrl) ||
          (channel === "X_TWITTER" && lead.twitterUrl),
  );

  return {
    shouldContactNow:
      contactable &&
      !lead.suppressed &&
      lead.status !== "DO_NOT_CONTACT" &&
      temperature !== "DISQUALIFIED" &&
      auditVerdict !== "REJECT" &&
      auditVerdict !== "HOLD",
    channel,
    tone: lead.originalPost ? "consultative" : "conversational",
    firstMessageGoal: "Open a relevant conversation around one observed opportunity.",
    talkingPoints: [
      lead.website ? `Reference the public website ${lead.website}` : "Do not invent a website visit",
      service ? `Keep the service hypothesis to ${service}` : "Stay diagnostic, not pitchy",
    ],
    doNotSay: [
      "Do not claim they requested a service unless originalPost/notes say so.",
      "Do not use generic agency spam.",
      "Do not invent metrics, case studies, or personal facts.",
    ],
    followUpStrategy:
      "If approved and sent later, wait at least 4 business days before one short follow-up. Stop on opt-out.",
    reasonForContacting: contactable
      ? `There is a reachable ${channel.toLowerCase()} identity and an observed business/digital signal.`
      : "No reachable channel is present on the lead record.",
  };
}

function isChannel(value: unknown): value is OutreachChannel {
  return (
    value === "EMAIL" ||
    value === "LINKEDIN" ||
    value === "INSTAGRAM" ||
    value === "FACEBOOK" ||
    value === "X_TWITTER"
  );
}

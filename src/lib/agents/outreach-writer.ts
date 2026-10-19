import "server-only";
import { getBusinessProfile } from "@/lib/business/profile";

import type { OutreachChannel } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { DEFAULT_PROMPTS } from "@/lib/prompts/defaults";
import { BaseAgent } from "@/lib/agents/base";
import { asLeadRecord, type AgentContext, type AgentResult } from "@/lib/agents/types";
import type { OutreachStrategy } from "@/types";
import { canEnterOutreach } from "@/lib/outreach/gate";
import { readSuppressionState, writeAudit } from "@/lib/db/settings";

export class OutreachWriterAgent extends BaseAgent {
  slug = "outreach_writer";
  name = "Outreach Writer Agent";
  description = "Writes evidence-based drafts for the approval queue.";

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.lead) return { ok: false, mode: "heuristic", output: null, error: "Lead is required" };
    if (ctx.lead.suppressed || ctx.lead.status === "DO_NOT_CONTACT") {
      return {
        ok: true,
        mode: "heuristic",
        output: { skipped: true, reason: "Lead is do-not-contact / suppressed." },
      };
    }

    const audit = await prisma.leadAudit.findFirst({
      where: { leadId: ctx.lead.id },
      orderBy: { createdAt: "desc" },
    });
    const suppression = await readSuppressionState({
      email: ctx.lead.email,
      websiteHost: ctx.lead.websiteHost,
      phone: ctx.lead.phone,
    });
    const testRecipientConfirmed = await import("@/lib/outreach/test-recipient").then((mod) =>
      mod.isConfirmedTestRecipient(ctx.lead!.id),
    );
    const eligibility = canEnterOutreach({
      verdict: audit?.verdict,
      auditedAt: audit?.createdAt,
      suppressed: ctx.lead.suppressed || suppression === "suppressed",
      unsubscribed: suppression === "suppressed",
      suppressionUnknown: suppression === "unknown",
      leadStatus: ctx.lead.status,
      purpose: "draft",
      testRecipientConfirmed,
    });
    if (!eligibility.ok) {
      await writeAudit({
        action: "lead.blocked",
        entity: "lead",
        entityId: ctx.lead.id,
        payload: { code: eligibility.code, reason: eligibility.reason, stage: "draft" },
      });
      return {
        ok: true,
        mode: "heuristic",
        output: { skipped: true, reason: eligibility.reason },
      };
    }

    const research = await prisma.leadResearch.findFirst({
      where: { leadId: ctx.lead.id },
      orderBy: { createdAt: "desc" },
    });
    const opportunity = await prisma.opportunity.findFirst({
      where: { leadId: ctx.lead.id },
      orderBy: { createdAt: "desc" },
    });
    const strategy = (ctx.payload?.strategy as OutreachStrategy | undefined) ??
      heuristicFallback(ctx.lead);
    const requestedChannel = (ctx.payload?.channel as OutreachChannel | undefined) ?? strategy.channel;
    const stepKind = typeof ctx.payload?.stepKind === "string" ? ctx.payload.stepKind : "INITIAL";
    const { qualifyCommercial, outboundWhyNowAllowed } = await import("@/lib/intelligence/commercial");
    const { prospectFromLeadFields } = await import("@/lib/intelligence/prospect");
    const { findingsToClaims } = await import("@/lib/intelligence/evidence");
    const commercial = qualifyCommercial(
      prospectFromLeadFields({
        ...ctx.lead,
        roleTitle: null,
        evidence: findingsToClaims(research?.findings),
      }),
    );
    if ((stepKind === "INITIAL" || !stepKind) && !outboundWhyNowAllowed(commercial) && !testRecipientConfirmed) {
      return {
        ok: true,
        mode: "heuristic",
        output: {
          skipped: true,
          reason: "No FACT Why Now — outbound draft blocked. Nurture until evidence exists.",
          selection: commercial.brief.selection,
        },
      };
    }

    if (!channelAvailable(ctx.lead, requestedChannel)) {
      return {
        ok: false,
        mode: "heuristic",
        output: null,
        error: `No ${requestedChannel} identity on this lead.`,
      };
    }

    const heuristic = buildDraft(ctx.lead, requestedChannel, opportunity, research, stepKind, commercial.brief);
    const ai = await this.askJson<{ subject: string | null; message: string; evidenceRefs: string[] }>(
      ctx.prompt || DEFAULT_PROMPTS.outreach_writer.content,
      JSON.stringify({
        lead: asLeadRecord(ctx.lead),
        channel: requestedChannel,
        strategy,
        opportunity,
        research,
        stepKind,
        heuristic,
      }),
    );

    const draft = ai.data?.message ? ai.data : heuristic;
    const mode = ai.data?.message ? "openai" : "heuristic";
    const promptRow = await prisma.prompt.findUnique({ where: { agentSlug: this.slug } });
    const modelProvider = ai.provider ? `${ai.provider}:${ai.model}` : "heuristic";
    const { parseOutreachAction } = await import("@/lib/contracts/outreach");
    const { ensureTrace, patchTrace } = await import("@/lib/intelligence/trace");
    const trace = await ensureTrace(ctx.lead.id);
    const action = parseOutreachAction({
      leadId: ctx.lead.leadId,
      channel: requestedChannel,
      draft: { subject: draft.subject ?? null, message: draft.message },
      evidenceRefs: draft.evidenceRefs ?? [],
      decisionId: audit?.id ?? null,
      approvalStatus: "PENDING_APPROVAL",
      promptVersion: promptRow?.version ?? 1,
    });

    await prisma.outreachDraft.updateMany({
      where: {
        leadId: ctx.lead.id,
        channel: requestedChannel,
        status: { in: ["DRAFT", "PENDING_APPROVAL"] },
      },
      data: { status: "SUPERSEDED" },
    });

    const created = await prisma.outreachDraft.create({
      data: {
        leadId: ctx.lead.id,
        channel: requestedChannel,
        subject: draft.subject,
        message: draft.message,
        tone: strategy.tone,
        status: "PENDING_APPROVAL",
        reasonForContacting: commercial.brief.whyNow
          ? `Why now: ${commercial.brief.whyNow}`
          : strategy.reasonForContacting,
        whatNotToSay: strategy.doNotSay,
        followUpStrategy: strategy.followUpStrategy,
        firstMessageGoal: strategy.firstMessageGoal,
        evidenceRefs: draft.evidenceRefs,
        campaignId: (ctx.payload?.campaignId as string | undefined) ?? null,
        stepKind,
        mode,
        decisionId: audit?.id ?? null,
        promptVersion: promptRow?.version ?? 1,
        modelProvider,
        traceId: trace.id,
      },
    });
    await patchTrace(trace.id, { draftId: created.id });

    await prisma.lead.update({
      where: { id: ctx.lead.id },
      data: { status: "READY_FOR_REVIEW", lastActivityAt: new Date() },
    });
    await writeAudit({
      action: "draft.created",
      entity: "outreach_draft",
      entityId: created.id,
      payload: { leadId: ctx.lead.id, channel: requestedChannel, stepKind, mode },
    });

    return {
      ok: true,
      mode,
      output: { draftId: created.id, ...draft, channel: requestedChannel, decisionId: audit?.id ?? null, parsed: action.success },
      promptVersion: promptRow?.version ?? 1,
      modelProvider,
    };
  }
}

function channelAvailable(lead: NonNullable<AgentContext["lead"]>, channel: OutreachChannel) {
  if (channel === "EMAIL") return Boolean(lead.email);
  if (channel === "LINKEDIN") return Boolean(lead.linkedinUrl);
  if (channel === "INSTAGRAM") return Boolean(lead.instagramUrl);
  if (channel === "FACEBOOK") return Boolean(lead.facebookUrl);
  return Boolean(lead.twitterUrl);
}

function heuristicFallback(lead: NonNullable<AgentContext["lead"]>): OutreachStrategy {
  return {
    shouldContactNow: true,
    channel: lead.email ? "EMAIL" : "LINKEDIN",
    tone: "conversational",
    firstMessageGoal: "Start a relevant conversation.",
    talkingPoints: [],
    doNotSay: ["Do not invent a service request."],
    followUpStrategy: "One follow-up after 4 business days if approved and sent later.",
    reasonForContacting: "Observed public business/digital signal.",
  };
}

function buildDraft(
  lead: NonNullable<AgentContext["lead"]>,
  channel: OutreachChannel,
  opportunity: { problem: string; evidence: string; recommendedService: string; evidenceUrl: string | null } | null,
  research: { websiteQualityNotes: string | null } | null,
  stepKind = "INITIAL",
  brief?: { whyNow?: string | null; whyUs?: string | null; recommendedCTA?: string | null } | null,
) {
  const who = lead.name ? lead.name.split(" ")[0] : lead.company || "there";
  const observation =
    brief?.whyNow ||
    opportunity?.evidence ||
    research?.websiteQualityNotes ||
    (lead.website ? `your public site at ${lead.website}` : "your public business presence");
  const problem = brief?.whyUs || opportunity?.problem || "a possible gap in the current digital setup";
  const cta = brief?.recommendedCTA || "If a 2-minute concept would be useful, I can send it.";
  const evidenceRefs = [lead.website, opportunity?.evidenceUrl].filter(Boolean) as string[];

  let body: string;
  if (stepKind === "FOLLOW_UP_SHORT") {
    body =
      channel === "EMAIL"
        ? `Hi ${who},\n\nQuick follow-up on my earlier note about ${observation}. If it is not relevant, ignore this.\n\n— ${getBusinessProfile().businessName}`
        : `Hi ${who} — just bumping my earlier note. No pressure if the timing is wrong.`;
  } else if (stepKind === "FOLLOW_UP_VALUE") {
    body =
      channel === "EMAIL"
        ? `Hi ${who},\n\nOne useful angle on ${problem}: teams usually wait until this is already costing hours. If you want a short outside view, I can send it.\n\n— ${getBusinessProfile().businessName}`
        : `Hi ${who} — one concrete take on ${problem.toLowerCase()} if useful. Happy to stop here.`;
  } else if (stepKind === "FOLLOW_UP_FINAL") {
    body =
      channel === "EMAIL"
        ? `Hi ${who},\n\nLast note from me. If ${problem.toLowerCase()} is not on the list, I will close the loop.\n\n— ${getBusinessProfile().businessName}`
        : `Hi ${who} — closing the loop on my side. Reply only if you want this.`;
  } else {
    body =
      channel === "EMAIL"
        ? `Hi ${who},\n\nNoticed ${observation}\n\nWe work with teams where that creates ${problem}\n\n${cta}\n\n— ${getBusinessProfile().businessName}`
        : `Hi ${who} — noticed ${observation}. ${cta}`;
  }

  return {
    subject:
      channel === "EMAIL"
        ? stepKind.startsWith("FOLLOW_UP")
          ? `Re: ${lead.company || "your site"}`
          : `Quick note on ${lead.company || "your site"}`
        : null,
    message: body,
    evidenceRefs,
  };
}

import "server-only";

import { prisma } from "@/lib/db/prisma";
import { DEFAULT_PROMPTS } from "@/lib/prompts/defaults";
import { BaseAgent } from "@/lib/agents/base";
import { asLeadRecord, type AgentContext, type AgentResult } from "@/lib/agents/types";
import { findingsToClaims } from "@/lib/intelligence/evidence";
import { evaluateLead, rawFromRecord } from "@/lib/intelligence/evaluate";
import { parseLeadSignals } from "@/lib/contracts/signals";
import { toLegacySignals } from "@/lib/intelligence/structured-signals";
import { ensureTrace } from "@/lib/intelligence/trace";
import type { WebsiteSnapshot } from "@/types";

async function loadStoredSignals(leadId: string) {
  const row = await prisma.leadSignalSet.findFirst({
    where: { leadId },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  const parsed = parseLeadSignals(row.payload);
  return parsed.success ? parsed.data : null;
}

export class QualificationAgent extends BaseAgent {
  slug = "qualification";
  name = "Lead Qualification Agent";
  description = "Scores and classifies leads using evidence only.";

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.lead) return { ok: false, mode: "heuristic", output: null, error: "Lead is required" };

    const [research, storedSignals] = await Promise.all([
      prisma.leadResearch.findFirst({
        where: { leadId: ctx.lead.id },
        orderBy: { createdAt: "desc" },
      }),
      loadStoredSignals(ctx.lead.id),
    ]);
    const snapshot = (research?.rawSnapshot as WebsiteSnapshot | null) ?? null;
    const evaluation = evaluateLead({
      raw: rawFromRecord(ctx.lead),
      snapshot,
      blocked: ctx.lead.suppressed || ctx.lead.status === "DO_NOT_CONTACT",
      signals: storedSignals ? toLegacySignals(storedSignals) : undefined,
      evidence: findingsToClaims(research?.findings),
    });
    const scored = evaluation.score;
    const ai = await this.askJson<{ reason?: string }>(
      ctx.prompt || DEFAULT_PROMPTS.qualification.content,
      JSON.stringify({
        lead: asLeadRecord(ctx.lead),
        research,
        evaluation,
      }),
    );
    const temperature = scored.classification;
    const mode = ai.data ? "openai" : "heuristic";
    const reason = [evaluation.reason, ai.data?.reason ? `Interpretation: ${ai.data.reason}` : ""]
      .filter(Boolean)
      .join(" ");

    await prisma.leadScore.create({
      data: {
        leadId: ctx.lead.id,
        score: scored.score,
        temperature,
        reason,
        breakdown: {
          fit: scored.fit,
          need: scored.need,
          intent: scored.intent,
          timing: scored.timing,
          accessibility: scored.accessibility,
          icpFit: evaluation.commercial.breakdown.icpFit,
          buyingSignal: evaluation.commercial.breakdown.buyingSignal,
          painEvidence: evaluation.commercial.breakdown.painEvidence,
          technologyGap: evaluation.commercial.breakdown.technologyGap,
          decisionMaker: evaluation.commercial.breakdown.decisionMaker,
          dataQuality: evaluation.commercial.breakdown.dataQuality,
          abilityToPay: evaluation.commercial.breakdown.abilityToPay,
          buyNowScore: evaluation.commercial.total,
          priority: evaluation.commercial.priority,
          selection: evaluation.commercial.brief.selection,
          commercial: evaluation.commercial.brief,
          decision: evaluation.decision,
          risks: [...scored.risks, ...evaluation.commercial.risks],
          unknowns: evaluation.unknowns,
          recommendedAction: evaluation.commercial.priority
            ? "PRIORITY — draft Why Now for human approval"
            : evaluation.commercial.nurture
              ? "NURTURE — do not outbound until FACT Why Now exists"
              : evaluation.decision === "SKIP"
                ? "SKIP"
                : evaluation.decision,
        },
        evidenceUsed: [
          storedSignals ? `signalSet:${storedSignals.leadId}` : "signals:derived",
          `opportunity:${evaluation.opportunity.opportunityKey}`,
          `evidence_type:${evaluation.opportunity.confidence}`,
          evaluation.signals.explicit_request ? "explicit request" : "no explicit request",
          evaluation.signals.operational_complexity ? "operational complexity described" : "",
          ctx.lead.website ? `website:${ctx.lead.website}` : "no website",
        ].filter(Boolean),
        mode,
      },
    });

    const { persistCommercialOpportunity } = await import("@/lib/intelligence/persist-opportunity");
    await persistCommercialOpportunity({
      leadId: ctx.lead.id,
      evaluation,
      mode,
      writeScore: false,
    });

    await prisma.lead.update({
      where: { id: ctx.lead.id },
      data: {
        temperature,
        status:
          ctx.lead.status === "DO_NOT_CONTACT"
            ? "DO_NOT_CONTACT"
            : evaluation.commercial.priority
              ? "QUALIFIED"
              : ctx.lead.status === "NEW" || evaluation.decision === "QUALIFIED"
                ? "RESEARCHED"
                : ctx.lead.status,
        lastActivityAt: new Date(),
      },
    });

    await ensureTrace(ctx.lead.id);

    return {
      ok: true,
      mode,
      output: { ...scored, temperature, evaluation, usedStoredSignals: Boolean(storedSignals) },
      promptVersion: (await prisma.prompt.findUnique({ where: { agentSlug: this.slug } }))?.version ?? 1,
      modelProvider: ai.provider ? `${ai.provider}:${ai.model}` : "heuristic",
      error: ai.data ? undefined : ai.error,
    };
  }
}

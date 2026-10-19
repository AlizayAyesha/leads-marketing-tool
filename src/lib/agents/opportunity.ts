import "server-only";

import { prisma } from "@/lib/db/prisma";
import { DEFAULT_PROMPTS } from "@/lib/prompts/defaults";
import { BaseAgent } from "@/lib/agents/base";
import { asLeadRecord, type AgentContext, type AgentResult } from "@/lib/agents/types";
import { findingsToClaims } from "@/lib/intelligence/evidence";
import { evaluateLead, rawFromRecord } from "@/lib/intelligence/evaluate";
import { parseLeadSignals } from "@/lib/contracts/signals";
import { toLegacySignals } from "@/lib/intelligence/structured-signals";
import { ensureTrace, patchTrace } from "@/lib/intelligence/trace";
import type { OpportunityOutput } from "@/types";
import type { WebsiteSnapshot } from "@/types";

export class OpportunityAgent extends BaseAgent {
  slug = "opportunity";
  name = "Opportunity Intelligence Agent";
  description = "Detects a business problem first, then matches one of your solutions if one fits.";

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.lead) return { ok: false, mode: "heuristic", output: null, error: "Lead is required" };

    const [research, linkedinResearch, instagramResearch, signalRow, promptRow] = await Promise.all([
      prisma.leadResearch.findFirst({
        where: { leadId: ctx.lead.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.linkedInResearch.findFirst({
        where: { leadId: ctx.lead.id },
        orderBy: { retrievedAt: "desc" },
      }),
      prisma.instagramResearch.findFirst({
        where: { leadId: ctx.lead.id },
        orderBy: { retrievedAt: "desc" },
      }),
      prisma.leadSignalSet.findFirst({
        where: { leadId: ctx.lead.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.prompt.findUnique({ where: { agentSlug: this.slug } }),
    ]);
    const storedSignals = signalRow ? parseLeadSignals(signalRow.payload) : null;
    const evaluation = evaluateLead({
      raw: rawFromRecord(ctx.lead),
      snapshot: (research?.rawSnapshot as WebsiteSnapshot | null) ?? null,
      blocked: ctx.lead.suppressed || ctx.lead.status === "DO_NOT_CONTACT",
      signals: storedSignals?.success ? toLegacySignals(storedSignals.data) : undefined,
      roleTitle: linkedinResearch?.roleTitle ?? null,
      evidence: findingsToClaims(research?.findings),
    });
    const detected = evaluation.opportunity;
    const solution = evaluation.solution;
    const specificProblem = specifyProblem(detected.problem, detected.evidence);

    const linkedinEvidence =
      linkedinResearch?.status === "AVAILABLE" && Array.isArray(linkedinResearch.evidenceItems)
        ? (linkedinResearch.evidenceItems as { evidence?: string; sourceUrl?: string | null; confidence?: string; category?: string }[])
        : [];
    const instagramEvidence =
      instagramResearch?.status === "AVAILABLE" && Array.isArray(instagramResearch.evidenceItems)
        ? (instagramResearch.evidenceItems as { evidence?: string; sourceUrl?: string | null; confidence?: string; category?: string }[])
        : [];
    const commercial = evaluation.commercial;
    const offer = commercial.offer;
    const offerLine = `${offer.primary.replaceAll("_", " ")} primary${
      offer.secondary ? `; ${offer.secondary.replaceAll("_", " ")} secondary` : ""
    } (${offer.angle})`;
    const heuristic: OpportunityOutput = {
      problem: specificProblem,
      evidence: detected.evidence,
      evidenceUrl: ctx.lead.website,
      recommendedService: commercial.rejected ? (solution?.zarService ?? "CUSTOM_SOFTWARE") : offer.zarService,
      suggestedOffer: commercial.rejected
        ? solution
          ? `${solution.name} — ${solution.reason}`
          : "No your business solution matched. Do not pitch a catalog item."
        : offerLine,
      projectCategory: detected.opportunityKey,
      nextStep:
        evaluation.decision === "SKIP" || evaluation.decision === "INSUFFICIENT_EVIDENCE" || commercial.rejected
          ? "SKIP — do not prepare outreach."
          : commercial.priority
            ? "PRIORITY opportunity — draft Why Now for human approval. Do not send."
            : commercial.nurture
              ? "NURTURE — missing FACT Why Now or PRIORITY gate. Do not outbound."
              : "HOLD — score is not send-ready.",
      confidence:
        detected.confidence === "FACT"
          ? "observed"
          : detected.confidence === "INFERENCE"
            ? "inferred"
            : "unknown",
    };

    const ai = await this.askJson<Partial<OpportunityOutput>>(
      ctx.prompt || DEFAULT_PROMPTS.opportunity.content,
      JSON.stringify({
        lead: asLeadRecord(ctx.lead),
        research,
        linkedinResearch: linkedinResearch
          ? {
              status: linkedinResearch.status,
              code: linkedinResearch.code,
              evidenceItems: linkedinResearch.evidenceItems,
              headline: linkedinResearch.headline,
              currentCompany: linkedinResearch.currentCompany,
              roleTitle: linkedinResearch.roleTitle,
            }
          : null,
        instagramResearch: instagramResearch
          ? {
              status: instagramResearch.status,
              code: instagramResearch.code,
              evidenceItems: instagramResearch.evidenceItems,
              username: instagramResearch.username,
              bio: instagramResearch.bio,
              professionalCategory: instagramResearch.professionalCategory,
            }
          : null,
        evaluation,
        heuristic,
      }),
    );

    const result: OpportunityOutput = {
      ...heuristic,
      nextStep: ai.data?.nextStep || heuristic.nextStep,
    };
    const mode = ai.data ? "openai" : "heuristic";
    const evidenceItems = [
      {
        text: result.evidence,
        sourceUrl: result.evidenceUrl,
        confidence: result.confidence,
      },
      ...linkedinEvidence
        .filter((item) => item.evidence && item.category !== "role_title" && item.category !== "headline")
        .slice(0, 8)
        .map((item) => ({
          text: item.evidence,
          sourceUrl: item.sourceUrl ?? linkedinResearch?.source ?? null,
          confidence: item.confidence === "inferred" ? "inferred" : "observed",
        })),
      ...instagramEvidence
        .filter((item) => item.evidence && item.category !== "username" && item.category !== "bio")
        .slice(0, 8)
        .map((item) => ({
          text: item.evidence,
          sourceUrl: item.sourceUrl ?? instagramResearch?.source ?? null,
          confidence: item.confidence === "inferred" ? "inferred" : "observed",
        })),
    ];
    const trace = await ensureTrace(ctx.lead.id);
    const { persistCommercialOpportunity } = await import("@/lib/intelligence/persist-opportunity");
    const created = await persistCommercialOpportunity({
      leadId: ctx.lead.id,
      evaluation,
      mode,
      signalSetId: signalRow?.id ?? null,
      traceId: trace.id,
      problemOverride: specificProblem,
      extraEvidenceItems: evidenceItems.slice(1),
      writeScore: true,
    });
    await patchTrace(trace.id, { opportunityId: created.id });

    await prisma.lead.update({
      where: { id: ctx.lead.id },
      data: { lastActivityAt: new Date() },
    });

    return {
      ok: true,
      mode,
      output: { ...result, id: created.id, detected, solution, evaluation },
      promptVersion: promptRow?.version ?? 1,
      modelProvider: ai.provider ? `${ai.provider}:${ai.model}` : "heuristic",
      error: ai.data ? undefined : ai.error,
    };
  }
}

function specifyProblem(problem: string, evidence: string) {
  if (/\bcompan(y|ies)\s+needs?\s+a\s+website\b/i.test(problem)) {
    return evidence.trim()
      ? `Public evidence points to a digital-ops gap: ${evidence.slice(0, 220)}`
      : "No stated operational problem. A public website alone is not a booking or workflow issue.";
  }
  return problem;
}

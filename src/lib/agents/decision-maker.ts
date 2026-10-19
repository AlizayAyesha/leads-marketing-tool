import "server-only";

import type { OutreachChannel } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { DEFAULT_PROMPTS } from "@/lib/prompts/defaults";
import { BaseAgent } from "@/lib/agents/base";
import { asLeadRecord, type AgentContext, type AgentResult } from "@/lib/agents/types";
import { auditLead, tightenVerdict, type AuditVerdict, type LeadAuditResult } from "@/lib/intelligence/audit";
import { parseLeadSignals } from "@/lib/contracts/signals";
import { parseDecisionContract } from "@/lib/contracts/decision";
import { ensureTrace, patchTrace, rememberTrace } from "@/lib/intelligence/trace";
import { writeAudit } from "@/lib/db/settings";

export class DecisionMakerAgent extends BaseAgent {
  slug = "decision_maker";
  name = "Decision Maker Agent";
  description =
    "Supervises lead quality: professional fit, email, LinkedIn seniority, Instagram presence, and whether they need your services services.";

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.lead) return { ok: false, mode: "heuristic", output: null, error: "Lead is required" };

    const [score, research, linkedinResearch, instagramResearch, signalRow, promptRow] = await Promise.all([
      prisma.leadScore.findFirst({ where: { leadId: ctx.lead.id }, orderBy: { createdAt: "desc" } }),
      prisma.leadResearch.findFirst({ where: { leadId: ctx.lead.id }, orderBy: { createdAt: "desc" } }),
      prisma.linkedInResearch.findFirst({ where: { leadId: ctx.lead.id }, orderBy: { retrievedAt: "desc" } }),
      prisma.instagramResearch.findFirst({ where: { leadId: ctx.lead.id }, orderBy: { retrievedAt: "desc" } }),
      prisma.leadSignalSet.findFirst({ where: { leadId: ctx.lead.id }, orderBy: { createdAt: "desc" } }),
      prisma.prompt.findUnique({ where: { agentSlug: this.slug } }),
    ]);
    const breakdown = (score?.breakdown ?? {}) as { decision?: string };
    const heuristic = auditLead({
      name: ctx.lead.name,
      company: ctx.lead.company,
      website: ctx.lead.website,
      websiteHost: ctx.lead.websiteHost,
      email: ctx.lead.email,
      linkedinUrl: ctx.lead.linkedinUrl,
      instagramUrl: ctx.lead.instagramUrl,
      twitterUrl: ctx.lead.twitterUrl,
      industry: ctx.lead.industry,
      location: ctx.lead.location,
      originalPost: ctx.lead.originalPost,
      notes: ctx.lead.notes,
      source: ctx.lead.source,
      rawPayload: ctx.lead.rawPayload,
      qualificationDecision: breakdown.decision ?? null,
      qualificationScore: score?.score ?? null,
      linkedinResearch: linkedinResearch
        ? {
            status: linkedinResearch.status,
            headline: linkedinResearch.headline,
            about: linkedinResearch.about,
            roleTitle: linkedinResearch.roleTitle,
            currentCompany: linkedinResearch.currentCompany,
            publicSignals: linkedinResearch.publicSignals,
          }
        : null,
      instagramResearch: instagramResearch
        ? {
            status: instagramResearch.status,
            bio: instagramResearch.bio,
            professionalCategory: instagramResearch.professionalCategory,
            publicBusinessInfo: instagramResearch.publicBusinessInfo,
            website: instagramResearch.website,
            publicSignals: instagramResearch.publicSignals,
          }
        : null,
    });

    const ai = await this.askJson<{
      verdict?: AuditVerdict;
      reason?: string;
      unknowns?: string[];
    }>(
      ctx.prompt || DEFAULT_PROMPTS.decision_maker.content,
      JSON.stringify({
        lead: asLeadRecord(ctx.lead),
        qualification: score
          ? { score: score.score, temperature: score.temperature, decision: breakdown.decision, reason: score.reason }
          : null,
        researchLimitations: research?.limitations ?? [],
        linkedinResearch: linkedinResearch
          ? { status: linkedinResearch.status, code: linkedinResearch.code, evidenceItems: linkedinResearch.evidenceItems }
          : null,
        instagramResearch: instagramResearch
          ? { status: instagramResearch.status, code: instagramResearch.code, evidenceItems: instagramResearch.evidenceItems }
          : null,
        heuristic,
      }),
    );

    const proposed = ai.data?.verdict;
    const result: LeadAuditResult = {
      ...heuristic,
      verdict: tightenVerdict(
        heuristic.verdict,
        proposed === "PASS" || proposed === "HOLD" || proposed === "REJECT" ? proposed : null,
      ),
      reason: [heuristic.reason, ai.data?.reason ? `Interpretation: ${ai.data.reason}` : ""].filter(Boolean).join(" "),
      unknowns: [...new Set([...heuristic.unknowns, ...(Array.isArray(ai.data?.unknowns) ? ai.data.unknowns : [])])],
    };
    const mode = ai.data ? "openai" : "heuristic";
    const storedSignals = signalRow ? parseLeadSignals(signalRow.payload) : null;
    const signalIds = storedSignals?.success
      ? storedSignals.data.items.filter((item) => item.present && !item.rejected).map((item) => item.id)
      : [];
    const modelProvider = ai.provider ? `${ai.provider}:${ai.model}` : "heuristic";
    const decisionPayload = parseDecisionContract({
      leadId: ctx.lead.leadId,
      verdict: result.verdict,
      reasons: [result.reason, ...result.blockers].filter(Boolean),
      evidence: result.evidenceUsed,
      score: score?.score ?? null,
      signalIds,
      promptVersion: promptRow?.version ?? 1,
      modelProvider,
      timestamp: new Date().toISOString(),
    });
    const trace = await ensureTrace(ctx.lead.id);

    const created = await prisma.leadAudit.create({
      data: {
        leadId: ctx.lead.id,
        verdict: result.verdict,
        professionalStatus: result.professional,
        emailStatus: result.email.status,
        linkedinStatus: result.linkedin.status,
        linkedinSeniority: result.linkedin.seniority,
        instagramStatus: result.instagram.status,
        instagramPresence: result.instagram.presence,
        serviceNeedStatus: result.serviceNeed.status,
        allowedChannels: result.allowedChannels,
        checks: result,
        summary: result.reason,
        blockers: result.blockers,
        unknowns: result.unknowns,
        evidenceUsed: result.evidenceUsed,
        recommendedAction: result.recommendedAction,
        mode,
        score: score?.score ?? null,
        promptVersion: promptRow?.version ?? 1,
        modelProvider,
        signalSetId: signalRow?.id ?? null,
        signalIds,
        traceId: trace.id,
      },
    });
    await patchTrace(trace.id, { decisionId: created.id });
    await rememberTrace({
      leadId: ctx.lead.id,
      publicLeadId: ctx.lead.leadId,
      kind: "decision",
      content: `Decision Maker ${result.verdict}`,
      traceId: trace.id,
      metadata: { verdict: result.verdict, promptVersion: promptRow?.version ?? 1, modelProvider },
    });
    await writeAudit({
      action: result.verdict === "PASS" ? "decision.evaluated" : "lead.blocked",
      entity: "lead",
      entityId: ctx.lead.id,
      payload: {
        verdict: result.verdict,
        reason: result.reason,
        blockers: result.blockers,
        recommendedAction: result.recommendedAction,
      },
    });

    if (result.verdict === "PASS" && result.allowedChannels.includes("LINKEDIN")) {
      const { maybeRecommendLinkedInConnection } = await import("@/lib/linkedin/connection/lifecycle");
      await maybeRecommendLinkedInConnection(ctx.lead.id, trace.id);
    }

    if (result.verdict === "REJECT" && ctx.lead.status !== "DO_NOT_CONTACT") {
      await prisma.lead.update({
        where: { id: ctx.lead.id },
        data: {
          temperature: "DISQUALIFIED",
          status: ctx.lead.status === "QUALIFIED" || ctx.lead.status === "READY_FOR_REVIEW" ? "RESEARCHED" : ctx.lead.status,
          lastActivityAt: new Date(),
        },
      });
    } else {
      await prisma.lead.update({
        where: { id: ctx.lead.id },
        data: { lastActivityAt: new Date() },
      });
    }

    return {
      ok: true,
      mode,
      output: {
        verdict: result.verdict,
        professional: result.professional,
        allowedChannels: result.allowedChannels as OutreachChannel[],
        recommendedAction: result.recommendedAction,
        decisionId: created.id,
        promptVersion: promptRow?.version ?? 1,
        modelProvider,
        parsed: decisionPayload.success,
      },
      promptVersion: promptRow?.version ?? 1,
      modelProvider,
      error: ai.data ? undefined : ai.error,
    };
  }
}

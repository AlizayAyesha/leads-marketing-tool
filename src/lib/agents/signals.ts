import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { BaseAgent } from "@/lib/agents/base";
import type { AgentContext, AgentResult } from "@/lib/agents/types";
import { buildLeadSignalsContract } from "@/lib/intelligence/structured-signals";
import { ensureTrace, patchTrace, rememberTrace } from "@/lib/intelligence/trace";
import { writeAudit } from "@/lib/db/settings";
import { SIGNAL_CONTRACT_VERSION } from "@/lib/contracts/common";
import type { EvidenceFinding } from "@/types";

export class SignalAgent extends BaseAgent {
  slug = "signals";
  name = "Signal Agent";
  description = "Turns stored lead + research evidence into structured signals. Does not qualify or draft.";

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.lead) return { ok: false, mode: "heuristic", output: null, error: "Lead is required" };

    const research = await prisma.leadResearch.findFirst({
      where: { leadId: ctx.lead.id },
      orderBy: { createdAt: "desc" },
    });
    const linkedin = await prisma.linkedInResearch.findFirst({
      where: { leadId: ctx.lead.id },
      orderBy: { retrievedAt: "desc" },
    });
    const instagram = await prisma.instagramResearch.findFirst({
      where: { leadId: ctx.lead.id },
      orderBy: { retrievedAt: "desc" },
    });
    const contract = buildLeadSignalsContract({
      leadId: ctx.lead.leadId,
      name: ctx.lead.name,
      company: ctx.lead.company,
      website: ctx.lead.website,
      email: ctx.lead.email,
      phone: ctx.lead.phone,
      linkedinUrl: ctx.lead.linkedinUrl,
      instagramUrl: ctx.lead.instagramUrl,
      facebookUrl: ctx.lead.facebookUrl,
      twitterUrl: ctx.lead.twitterUrl,
      industry: ctx.lead.industry,
      location: ctx.lead.location,
      originalPost: ctx.lead.originalPost,
      notes: ctx.lead.notes,
      source: ctx.lead.source,
      websiteQuality: research?.websiteQuality ?? null,
      findings: (research?.findings ?? []) as EvidenceFinding[],
      techSignals: Array.isArray(research?.techSignals) ? (research.techSignals as string[]) : [],
      problems: Array.isArray(research?.problems) ? (research.problems as string[]) : [],
      missingFeatures: Array.isArray(research?.missingFeatures) ? (research.missingFeatures as string[]) : [],
      linkedinResearch:
        linkedin?.status === "AVAILABLE"
          ? {
              status: linkedin.status,
              headline: linkedin.headline,
              currentCompany: linkedin.currentCompany,
              roleTitle: linkedin.roleTitle,
              location: linkedin.location,
              industry: linkedin.industry,
              about: linkedin.about,
              sourceUrl: linkedin.source ?? linkedin.normalizedUrl,
              evidenceItems: Array.isArray(linkedin.evidenceItems) ? linkedin.evidenceItems : [],
            }
          : linkedin
            ? { status: linkedin.status, evidenceItems: [] }
            : null,
      instagramResearch:
        instagram?.status === "AVAILABLE"
          ? {
              status: instagram.status,
              username: instagram.username,
              displayName: instagram.displayName,
              bio: instagram.bio,
              professionalCategory: instagram.professionalCategory,
              sourceUrl: instagram.source ?? instagram.normalizedUrl,
              evidenceItems: Array.isArray(instagram.evidenceItems) ? instagram.evidenceItems : [],
            }
          : instagram
            ? { status: instagram.status, evidenceItems: [] }
            : null,
    });

    const prompt = await prisma.prompt.findUnique({ where: { agentSlug: this.slug } });
    const trace = await ensureTrace(ctx.lead.id);
    const row = await prisma.leadSignalSet.create({
      data: {
        leadId: ctx.lead.id,
        version: SIGNAL_CONTRACT_VERSION,
        traceId: trace.id,
        payload: contract as unknown as Prisma.InputJsonValue,
      },
    });
    await patchTrace(trace.id, { signalSetId: row.id });
    await writeAudit({
      action: "signals.generated",
      entity: "lead_signal_set",
      entityId: row.id,
      payload: { leadId: ctx.lead.id, version: SIGNAL_CONTRACT_VERSION, present: contract.items.filter((item) => item.present).length },
    });
    await rememberTrace({
      leadId: ctx.lead.id,
      publicLeadId: ctx.lead.leadId,
      kind: "signals",
      content: `Stored ${contract.items.filter((item) => item.present && !item.rejected).length} evidenced signals.`,
      traceId: trace.id,
    });

    return {
      ok: true,
      mode: "heuristic",
      output: { signalSetId: row.id, contract, skippedLlm: true, note: "Signal Agent persists evidence; it does not re-qualify." },
      promptVersion: prompt?.version ?? 1,
      modelProvider: "heuristic",
      error: undefined,
    };
  }
}

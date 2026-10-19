import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { BaseAgent } from "@/lib/agents/base";
import type { AgentContext, AgentResult } from "@/lib/agents/types";
import { queryLinkedInResearch } from "@/lib/linkedin/query";
import { resolveLinkedInResearchProvider } from "@/lib/linkedin/registry";
import { shouldReuseLinkedInResearch } from "@/lib/linkedin/cache";
import { LINKEDIN_ADAPTER_ID, LINKEDIN_ADAPTER_VERSION, type LinkedInResearchResult } from "@/lib/linkedin/types";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import { ensureTrace, patchTrace, rememberTrace } from "@/lib/intelligence/trace";
import { writeAudit } from "@/lib/db/settings";
import { PDL_ADAPTER_ID } from "@/lib/pdl/constants";

export class LinkedInResearchAgent extends BaseAgent {
  slug = "linkedin_research";
  name = "LinkedIn Research Agent";
  description =
    "Authorized LinkedIn research only. Does not scrape, message, connect, like, comment, or follow.";

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.lead) return { ok: false, mode: "heuristic", output: null, error: "Lead is required" };

    const forceRefresh = Boolean(ctx.payload?.forceRefresh);
    const inspected = inspectLinkedInUrl(ctx.lead.linkedinUrl);
    const normalizedUrl = inspected.normalizedUrl;
    const trace = ctx.payload?.traceId
      ? { id: String(ctx.payload.traceId) }
      : await ensureTrace(ctx.lead.id);

    if (!forceRefresh) {
      const existing = await prisma.linkedInResearch.findFirst({
        where: {
          OR: [
            { leadId: ctx.lead.id },
            normalizedUrl ? { normalizedUrl } : undefined,
          ].filter(Boolean) as object[],
        },
        orderBy: { retrievedAt: "desc" },
      });
      if (
        existing &&
        shouldReuseLinkedInResearch({
          forceRefresh,
          retrievedAt: existing.retrievedAt,
          normalizedUrl: existing.normalizedUrl,
          requestedNormalizedUrl: normalizedUrl ?? existing.normalizedUrl,
        })
      ) {
        const reused = existing.leadId === ctx.lead.id ? existing : await copyResearch(ctx.lead.id, existing, trace.id);
        await patchTrace(trace.id, { linkedinResearchId: reused.id });
        return {
          ok: true,
          mode: "heuristic",
          output: {
            skipped: true,
            cached: true,
            researchId: reused.id,
            status: reused.status,
            code: reused.code,
            evidenceCount: Array.isArray(reused.evidenceItems) ? reused.evidenceItems.length : 0,
            traceId: trace.id,
          },
        };
      }
    }

    const queried = await queryLinkedInResearch({
      profileUrl: ctx.lead.linkedinUrl,
      provider: await resolveLinkedInResearchProvider(),
    });
    const stored = await persistLinkedInResearch({
      leadId: ctx.lead.id,
      result: queried,
      normalizedUrl,
      profileUrl: ctx.lead.linkedinUrl,
      traceId: trace.id,
    });
    await patchTrace(trace.id, { linkedinResearchId: stored.id });
    await writeAudit({
      action: "LINKEDIN_RESEARCH_STORED",
      entity: "linkedin_research",
      entityId: stored.id,
      payload: {
        leadId: ctx.lead.leadId,
        status: queried.status,
        code: queried.code,
        evidenceCount: queried.evidence.length,
        traceId: trace.id,
      },
    });
    if (queried.adapter === PDL_ADAPTER_ID && queried.status === "AVAILABLE") {
      await writeAudit({
        action: "pdl.person_enrich",
        entity: "lead",
        entityId: ctx.lead.id,
        payload: { purpose: "linkedin_research", code: queried.code, traceId: trace.id },
      });
    }
    await rememberTrace({
      leadId: ctx.lead.id,
      publicLeadId: ctx.lead.leadId,
      kind: "linkedin_research",
      content: `LinkedIn research ${queried.status} (${queried.code}). ${queried.evidence.length} evidence items.`,
      traceId: trace.id,
    });

    await prisma.lead.update({
      where: { id: ctx.lead.id },
      data: { lastActivityAt: new Date() },
    });

    return {
      ok: true,
      mode: "heuristic",
      output: {
        researchId: stored.id,
        status: queried.status,
        code: queried.code,
        message: queried.message ?? null,
        evidence: queried.evidence,
        profile: queried.profile,
        sourceUrl: queried.sourceUrl,
        retrievedAt: queried.retrievedAt,
        traceId: trace.id,
        cached: false,
      },
      modelProvider: "heuristic",
    };
  }
}

async function persistLinkedInResearch(input: {
  leadId: string;
  result: LinkedInResearchResult;
  normalizedUrl: string | null;
  profileUrl: string | null;
  traceId: string;
}) {
  return prisma.linkedInResearch.create({
    data: {
      leadId: input.leadId,
      profileUrl: input.result.profile?.profileUrl ?? input.profileUrl,
      normalizedUrl: input.normalizedUrl,
      status: input.result.status,
      code: input.result.code,
      displayName: input.result.profile?.displayName ?? null,
      headline: input.result.profile?.headline ?? null,
      currentCompany: input.result.profile?.currentCompany ?? null,
      roleTitle: input.result.profile?.roleTitle ?? null,
      location: input.result.profile?.location ?? null,
      industry: input.result.profile?.industry ?? null,
      about: input.result.profile?.about ?? null,
      companyAssociation: input.result.profile?.companyAssociation ?? null,
      publicSignals: (input.result.profile?.publicSignals ?? {}) as Prisma.InputJsonValue,
      evidenceItems: input.result.evidence as unknown as Prisma.InputJsonValue,
      source: input.result.sourceUrl,
      adapter: input.result.adapter || LINKEDIN_ADAPTER_ID,
      adapterVersion: input.result.adapterVersion || LINKEDIN_ADAPTER_VERSION,
      retrievedAt: new Date(input.result.retrievedAt),
      errorMessage: input.result.status === "AVAILABLE" ? null : (input.result.message ?? input.result.code),
      traceId: input.traceId,
    },
  });
}

async function copyResearch(
  leadId: string,
  existing: {
    profileUrl: string | null;
    normalizedUrl: string | null;
    status: string;
    code: string;
    displayName: string | null;
    headline: string | null;
    currentCompany: string | null;
    roleTitle: string | null;
    location: string | null;
    industry: string | null;
    about: string | null;
    companyAssociation: string | null;
    publicSignals: unknown;
    evidenceItems: unknown;
    source: string | null;
    adapter: string;
    adapterVersion: string;
    retrievedAt: Date;
    errorMessage: string | null;
  },
  traceId: string,
) {
  const available = existing.status === "AVAILABLE";
  return persistLinkedInResearch({
    leadId,
    normalizedUrl: existing.normalizedUrl,
    profileUrl: existing.profileUrl,
    traceId,
    result: {
      status: existing.status as LinkedInResearchResult["status"],
      code: existing.code,
      profile: available
        ? {
            profileUrl: existing.profileUrl || existing.normalizedUrl || "",
            displayName: existing.displayName,
            headline: existing.headline,
            currentCompany: existing.currentCompany,
            roleTitle: existing.roleTitle,
            location: existing.location,
            industry: existing.industry,
            about: existing.about,
            companyAssociation: existing.companyAssociation,
            publicSignals:
              existing.publicSignals && typeof existing.publicSignals === "object" && !Array.isArray(existing.publicSignals)
                ? (existing.publicSignals as Record<string, unknown>)
                : {},
          }
        : null,
      evidence: Array.isArray(existing.evidenceItems) ? (existing.evidenceItems as LinkedInResearchResult["evidence"]) : [],
      sourceUrl: existing.source,
      retrievedAt: existing.retrievedAt.toISOString(),
      adapter: existing.adapter,
      adapterVersion: existing.adapterVersion,
      message: existing.errorMessage ?? undefined,
      cached: true,
    },
  });
}

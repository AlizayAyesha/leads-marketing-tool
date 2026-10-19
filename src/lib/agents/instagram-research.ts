import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { BaseAgent } from "@/lib/agents/base";
import type { AgentContext, AgentResult } from "@/lib/agents/types";
import { queryInstagramResearch } from "@/lib/instagram/query";
import { getInstagramResearchProvider } from "@/lib/instagram/registry";
import { shouldReuseInstagramResearch } from "@/lib/instagram/cache";
import { INSTAGRAM_ADAPTER_ID, INSTAGRAM_ADAPTER_VERSION, type InstagramResearchResult } from "@/lib/instagram/types";
import { inspectInstagramUrl } from "@/lib/instagram/url";
import { ensureTrace, patchTrace, rememberTrace } from "@/lib/intelligence/trace";
import { writeAudit } from "@/lib/db/settings";

export class InstagramResearchAgent extends BaseAgent {
  slug = "instagram_research";
  name = "Instagram Research Agent";
  description =
    "Authorized Instagram research only. Does not scrape, DM, like, follow, comment, or use Chrome login.";

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.lead) return { ok: false, mode: "heuristic", output: null, error: "Lead is required" };

    const forceRefresh = Boolean(ctx.payload?.forceRefresh);
    const inspected = inspectInstagramUrl(ctx.lead.instagramUrl);
    const normalizedUrl = inspected.normalizedUrl;
    const trace = ctx.payload?.traceId
      ? { id: String(ctx.payload.traceId) }
      : await ensureTrace(ctx.lead.id);

    if (!forceRefresh) {
      const existing = await prisma.instagramResearch.findFirst({
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
        shouldReuseInstagramResearch({
          forceRefresh,
          retrievedAt: existing.retrievedAt,
          normalizedUrl: existing.normalizedUrl,
          requestedNormalizedUrl: normalizedUrl ?? existing.normalizedUrl,
        })
      ) {
        const reused = existing.leadId === ctx.lead.id ? existing : await copyResearch(ctx.lead.id, existing, trace.id);
        await patchTrace(trace.id, { instagramResearchId: reused.id });
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

    const queried = await queryInstagramResearch({
      profileUrl: ctx.lead.instagramUrl,
      provider: getInstagramResearchProvider(),
    });
    const stored = await persistInstagramResearch({
      leadId: ctx.lead.id,
      result: queried,
      normalizedUrl,
      profileUrl: ctx.lead.instagramUrl,
      username: inspected.username ?? queried.profile?.username ?? null,
      traceId: trace.id,
    });
    await patchTrace(trace.id, { instagramResearchId: stored.id });
    await writeAudit({
      action: "INSTAGRAM_RESEARCH_STORED",
      entity: "instagram_research",
      entityId: stored.id,
      payload: {
        leadId: ctx.lead.leadId,
        status: queried.status,
        code: queried.code,
        evidenceCount: queried.evidence.length,
        traceId: trace.id,
      },
    });
    await rememberTrace({
      leadId: ctx.lead.id,
      publicLeadId: ctx.lead.leadId,
      kind: "instagram_research",
      content: `Instagram research ${queried.status} (${queried.code}). ${queried.evidence.length} evidence items.`,
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

async function persistInstagramResearch(input: {
  leadId: string;
  result: InstagramResearchResult;
  normalizedUrl: string | null;
  profileUrl: string | null;
  username: string | null;
  traceId: string;
}) {
  return prisma.instagramResearch.create({
    data: {
      leadId: input.leadId,
      profileUrl: input.result.profile?.profileUrl ?? input.profileUrl,
      normalizedUrl: input.normalizedUrl,
      username: input.result.profile?.username ?? input.username,
      status: input.result.status,
      code: input.result.code,
      displayName: input.result.profile?.displayName ?? null,
      bio: input.result.profile?.bio ?? null,
      professionalCategory: input.result.profile?.professionalCategory ?? null,
      publicBusinessInfo: input.result.profile?.publicBusinessInfo ?? null,
      website: input.result.profile?.website ?? null,
      businessContact: input.result.profile?.businessContact ?? null,
      publicSignals: (input.result.profile?.publicSignals ?? {}) as Prisma.InputJsonValue,
      evidenceItems: input.result.evidence as unknown as Prisma.InputJsonValue,
      source: input.result.sourceUrl,
      adapter: input.result.adapter || INSTAGRAM_ADAPTER_ID,
      adapterVersion: input.result.adapterVersion || INSTAGRAM_ADAPTER_VERSION,
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
    username: string | null;
    status: string;
    code: string;
    displayName: string | null;
    bio: string | null;
    professionalCategory: string | null;
    publicBusinessInfo: string | null;
    website: string | null;
    businessContact: string | null;
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
  return persistInstagramResearch({
    leadId,
    normalizedUrl: existing.normalizedUrl,
    profileUrl: existing.profileUrl,
    username: existing.username,
    traceId,
    result: {
      status: existing.status as InstagramResearchResult["status"],
      code: existing.code,
      profile: available
        ? {
            profileUrl: existing.profileUrl || existing.normalizedUrl || "",
            username: existing.username,
            displayName: existing.displayName,
            bio: existing.bio,
            professionalCategory: existing.professionalCategory,
            publicBusinessInfo: existing.publicBusinessInfo,
            website: existing.website,
            businessContact: existing.businessContact,
            publicSignals:
              existing.publicSignals && typeof existing.publicSignals === "object" && !Array.isArray(existing.publicSignals)
                ? (existing.publicSignals as Record<string, unknown>)
                : {},
          }
        : null,
      evidence: Array.isArray(existing.evidenceItems) ? (existing.evidenceItems as InstagramResearchResult["evidence"]) : [],
      sourceUrl: existing.source,
      retrievedAt: existing.retrievedAt.toISOString(),
      adapter: existing.adapter,
      adapterVersion: existing.adapterVersion,
      message: existing.errorMessage ?? undefined,
      cached: true,
    },
  });
}

import "server-only";

import { prisma } from "@/lib/db/prisma";
import { WebsiteResearchAdapter } from "@/lib/data-sources/website-research";
import { researchFromSnapshot } from "@/lib/intelligence/research-heuristic";
import { DEFAULT_PROMPTS } from "@/lib/prompts/defaults";
import { BaseAgent } from "@/lib/agents/base";
import { asLeadRecord, type AgentContext, type AgentResult } from "@/lib/agents/types";
import type { EvidenceFinding, WebsiteSnapshot } from "@/types";
import { chooseWebsiteLinkedInUrl, type ExtractedLinkedInUrl } from "@/lib/enrichment/website-linkedin";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import { writeAudit } from "@/lib/db/settings";

const websiteAdapter = new WebsiteResearchAdapter();

export class ResearchAgent extends BaseAgent {
  slug = "research";
  name = "Lead Research Agent";
  description = "Public website research with evidence-backed findings.";

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (!ctx.lead) return { ok: false, mode: "heuristic", output: null, error: "Lead is required" };
    const lead = ctx.lead;
    const existing = await prisma.leadResearch.findFirst({
      where: { leadId: lead.id },
      orderBy: { createdAt: "desc" },
    });
    if (existing && !ctx.payload?.forceRefresh) {
      return {
        ok: true,
        mode: existing.mode === "openai" ? "openai" : "heuristic",
        output: { skipped: true, reason: "Research already exists — not duplicated." },
      };
    }

    let snapshot: WebsiteSnapshot | null = (ctx.payload?.snapshot as WebsiteSnapshot | undefined) ?? null;

    if (!snapshot && lead.website) {
      const acquired = await websiteAdapter.acquire({ url: lead.website });
      snapshot = acquired.data;
    }

    if (snapshot) {
      await maybeStoreWebsiteLinkedIn(lead.id, lead.name, lead.linkedinUrl, snapshot);
    }

    const heuristic = researchFromSnapshot(lead, snapshot);
    const prompt = ctx.prompt || DEFAULT_PROMPTS.research.content;
    const ai = await this.askJson<typeof heuristic>(
      prompt,
      JSON.stringify({ lead: asLeadRecord(lead), snapshot, heuristic }),
    );

    const result = ai.data ? mergeResearch(heuristic, ai.data) : heuristic;
    const mode = ai.data ? "openai" : "heuristic";

    await prisma.leadResearch.create({
      data: {
        leadId: lead.id,
        websiteQuality: result.websiteQuality,
        websiteQualityNotes: result.websiteQualityNotes,
        techSignals: result.techSignals,
        problems: result.problems,
        missingFeatures: result.missingFeatures,
        webDevOpportunities: result.webDevOpportunities,
        aiOpportunities: result.aiOpportunities,
        seoOpportunities: result.seoOpportunities,
        brandingOpportunities: result.brandingOpportunities,
        findings: result.findings,
        limitations: result.limitations,
        rawSnapshot: snapshot ?? undefined,
        mode,
      },
    });

    if (lead.status === "NEW") {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: "RESEARCHED", lastActivityAt: new Date() },
      });
    } else {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { lastActivityAt: new Date() },
      });
    }

    return { ok: true, mode, output: result, error: ai.data ? undefined : ai.error };
  }
}

function mergeResearch(
  heuristic: ReturnType<typeof researchFromSnapshot>,
  ai: ReturnType<typeof researchFromSnapshot>,
) {
  const findings = Array.isArray(ai.findings) && ai.findings.length ? ai.findings : heuristic.findings;
  return {
    ...heuristic,
    ...ai,
    findings: sanitizeFindings(findings, heuristic),
    limitations: Array.from(
      new Set([...(heuristic.limitations ?? []), ...(ai.limitations ?? [])]),
    ),
  };
}

function sanitizeFindings(
  findings: EvidenceFinding[],
  heuristic: ReturnType<typeof researchFromSnapshot>,
) {
  const allowed = new Set<string>();
  for (const finding of heuristic.findings) {
    if (finding.sourceUrl) allowed.add(finding.sourceUrl);
    if (finding.evidence) allowed.add(finding.evidence);
  }
  return findings.filter((finding) => {
    if (!finding?.finding || !finding.evidence) return false;
    if (finding.confidence === "observed" && finding.sourceUrl) {
      return (
        allowed.has(finding.sourceUrl) ||
        heuristic.findings.some((item) => item.sourceUrl === finding.sourceUrl)
      );
    }
    return Boolean(finding.evidence);
  });
}

async function maybeStoreWebsiteLinkedIn(
  leadId: string,
  name: string | null,
  existingUrl: string | null,
  snapshot: WebsiteSnapshot,
) {
  const extracted: ExtractedLinkedInUrl[] = [];
  for (const raw of snapshot.linkedinUrls ?? []) {
    const inspected = inspectLinkedInUrl(raw);
    if ((inspected.kind === "person" || inspected.kind === "company") && inspected.normalizedUrl) {
      extracted.push({ url: inspected.normalizedUrl, kind: inspected.kind });
    }
  }
  const chosen = chooseWebsiteLinkedInUrl({ extracted, leadName: name, existingUrl });
  if (!chosen) return;
  await prisma.lead.update({
    where: { id: leadId },
    data: { linkedinUrl: chosen.url, lastActivityAt: new Date() },
  });
  await writeAudit({
    action: "lead.linkedin_from_website",
    entity: "lead",
    entityId: leadId,
    payload: { url: chosen.url, reason: chosen.reason },
  });
}

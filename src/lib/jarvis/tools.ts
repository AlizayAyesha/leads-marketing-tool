import "server-only";

/**
 * Tool adapters over the existing workforce.
 * request_send uses sendApprovedDraft only — no second send path.
 * execute_intent always forbids send; interpretCommand is an adapter, not the chat UI.
 */

import { interpretCommand } from "@/lib/agents/orchestrator";
import { productionLeadWhere } from "@/lib/analytics/production";
import { getIntelligenceDashboard } from "@/lib/analytics/intelligence-dashboard";
import { prisma } from "@/lib/db/prisma";
import { qualifyCommercial } from "@/lib/intelligence/commercial";
import { parseBriefFromEvidenceItems } from "@/lib/intelligence/brief-parse";
import { LIST_OPPORTUNITY_SELECTION } from "@/lib/intelligence/opportunity-listing";
import { prospectFromLeadFields } from "@/lib/intelligence/prospect";
import { sendApprovedDraft } from "@/lib/outreach/send";
import { buildExecutionSnapshot } from "@/lib/jarvis/execution-brief";
import { JARVIS_INTERPRET_IS_ADAPTER } from "@/lib/jarvis/invariant";
import { executeIntentCommand } from "@/lib/jarvis/execute-intent";
import { cancelScrapingJob, getScrapingJob, runScrapingJob, searchScrapedData } from "@/lib/scraping/service";

export async function runJarvisTool(name: string, args: Record<string, unknown>, context: {
  lastLeadId?: string | null;
  lastDraftId?: string | null;
}) {
  if (name === "get_execution_brief") {
    return buildExecutionSnapshot();
  }
  if (name === "get_analytics") {
    return getIntelligenceDashboard();
  }
  if (name === "execute_intent") {
    const command = executeIntentCommand(String(args.command ?? ""));
    const result = await interpretCommand(command);
    return { adapter: JARVIS_INTERPRET_IS_ADAPTER, ...result };
  }
  if (name === "get_lead") {
    const id = String(args.leadId ?? context.lastLeadId ?? "").trim();
    if (!id) return { error: "No lead in context. Name a company or ZJ- id." };
    const lead = await prisma.lead.findFirst({
      where: {
        AND: [
          productionLeadWhere(),
          {
            OR: [
              { leadId: { equals: id, mode: "insensitive" } },
              { id },
              { company: { contains: id, mode: "insensitive" } },
              { name: { contains: id, mode: "insensitive" } },
            ],
          },
        ],
      },
      include: {
        scores: { orderBy: { createdAt: "desc" }, take: 1 },
        audits: { orderBy: { createdAt: "desc" }, take: 1 },
        opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
        research: { orderBy: { createdAt: "desc" }, take: 1 },
        drafts: { orderBy: { createdAt: "desc" }, take: 3 },
      },
    });
    if (!lead) return { error: `No production lead matched ${id}.` };
    const commercial = qualifyCommercial(prospectFromLeadFields(lead));
    return {
      leadId: lead.leadId,
      recordId: lead.id,
      name: lead.name,
      company: lead.company,
      status: lead.status,
      decisionMaker: lead.audits[0]?.verdict ?? null,
      decisionSummary: lead.audits[0]?.summary ?? null,
      storedScore: lead.scores[0]?.score ?? null,
      commercialTotal: commercial.total,
      commercialBand: commercial.band,
      commercialReasons: commercial.reasons,
      commercialRisks: commercial.risks,
      opportunitySelection: lead.opportunities[0]?.selection ?? commercial.brief.selection,
      opportunity: lead.opportunities[0]?.problem ?? null,
      drafts: lead.drafts.map((d) => ({ id: d.id, status: d.status, channel: d.channel, stepKind: d.stepKind })),
    };
  }
  if (name === "list_opportunities") {
    const take = Math.min(8, Number(args.limit ?? 5) || 5);
    const rows = await prisma.opportunity.findMany({
      where: { selection: LIST_OPPORTUNITY_SELECTION, lead: productionLeadWhere() },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take,
      include: {
        lead: {
          include: {
            scores: { orderBy: { createdAt: "desc" }, take: 1 },
            audits: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });
    return rows.map((row) => {
      const stored = parseBriefFromEvidenceItems(row.evidenceItems);
      const commercial = stored ? null : qualifyCommercial(prospectFromLeadFields(row.lead));
      const brief = stored ?? commercial?.brief;
      return {
        leadId: row.lead.leadId,
        company: row.lead.company,
        name: row.lead.name,
        selection: row.selection,
        who: row.lead.company,
        whyThem: brief?.icpLabel ?? null,
        whyNow: brief?.whyNow ?? null,
        problem: row.problem,
        offer: brief?.recommendedOffer ?? row.suggestedOffer,
        confidence: row.confidence,
        next: row.nextStep,
        decisionMaker: row.lead.audits[0]?.verdict ?? null,
        commercialTotal: row.score ?? commercial?.total ?? null,
        commercialBand: commercial?.band ?? null,
      };
    });
  }
  if (name === "get_draft") {
    const id = String(args.draftId ?? context.lastDraftId ?? "").trim();
    if (!id) return { error: "No draft in context." };
    const draft = await prisma.outreachDraft.findFirst({
      where: { id, lead: productionLeadWhere() },
      include: { lead: true },
    });
    if (!draft) return { error: "Draft not found." };
    return {
      id: draft.id,
      status: draft.status,
      channel: draft.channel,
      subject: draft.subject,
      message: draft.message,
      leadId: draft.lead.leadId,
      company: draft.lead.company,
    };
  }
  if (name === "list_pending_drafts") {
    const drafts = await prisma.outreachDraft.findMany({
      where: {
        status: { in: ["PENDING_APPROVAL", "EDITED"] },
        NOT: { stepKind: "TEST_TRANSPORT" },
        lead: productionLeadWhere(),
      },
      take: 8,
      orderBy: { createdAt: "desc" },
      include: { lead: true },
    });
    return drafts.map((d) => ({
      id: d.id,
      leadId: d.lead.leadId,
      company: d.lead.company,
      channel: d.channel,
      status: d.status,
    }));
  }
  if (name === "request_send") {
    const draftId = String(args.draftId ?? context.lastDraftId ?? "").trim();
    if (!draftId) return { sent: false, error: "No draft to send. Approve on Outreach first, then name the draft." };
    return sendApprovedDraft(draftId, { explicitApproval: true, command: String(args.command ?? "Send that.") });
  }
  if (name === "run_scraper") {
    return runScrapingJob({
      scraper: String(args.scraper ?? "website-http"),
      operation: String(args.operation ?? "scrape") as "scrape" | "crawl" | "search" | "extract",
      input: {
        urls: Array.isArray(args.urls) ? args.urls.map(String) : [],
        query: typeof args.query === "string" ? args.query : undefined,
        allowedDomains: Array.isArray(args.allowedDomains) ? args.allowedDomains.map(String) : [],
        maxRequests: Number(args.maxRequests ?? 10),
      },
      createdBy: "jarvis",
    });
  }
  if (name === "get_scraper_job") return getScrapingJob(String(args.jobId ?? ""));
  if (name === "cancel_scraper_job") return cancelScrapingJob(String(args.jobId ?? ""));
  if (name === "search_scraped_data") return searchScrapedData(String(args.query ?? ""), Number(args.limit ?? 10));
  if (name === "get_scraped_evidence") return prisma.scrapedEvidence.findUnique({ where: { id: String(args.evidenceId ?? "") }, include: { job: true } });
  return { error: `Unknown tool ${name}` };
}

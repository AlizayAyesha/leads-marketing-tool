import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { FiverrTool } from "@/lib/tools/fiverr";
import { remember } from "@/lib/brain/memory";
import { emitBrainEvent } from "@/lib/brain/events";
import { qualifyFiverrRequest } from "@/lib/platforms/fiverr/qualify";
import type { PlatformAgent, PlatformAgentResult, PlatformTask } from "@/lib/platforms/types";

const tool = new FiverrTool();

export class FiverrAgent implements PlatformAgent {
  id = "fiverr";
  name = "Fiverr Agent";
  platform = "fiverr";
  capabilities = [
    "find_freelance_opportunities",
    "analyze_fiverr_gigs",
    "optimize_fiverr_gig",
    "draft_fiverr_response",
  ] as const;
  permissions = ["read_imported_gigs", "draft_response", "no_external_submit"];

  async execute(task: PlatformTask): Promise<PlatformAgentResult> {
    if (task.type === "search") return this.search();
    if (task.type === "import_gig") return this.importGig(task.payload ?? {});
    if (task.type === "import_inquiry") return this.importInquiry(task.payload ?? {});
    if (task.type === "list_gigs") {
      const gigs = await prisma.gigProfile.findMany({ orderBy: { updatedAt: "desc" } });
      return { ok: true, output: gigs };
    }
    return { ok: false, output: null, error: `Unknown Fiverr task: ${task.type}` };
  }

  private async search(): Promise<PlatformAgentResult> {
    const remote = await tool.listGigs();
    const inquiries = await prisma.buyerInquiry.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const gigs = await prisma.gigProfile.findMany({ take: 20, orderBy: { updatedAt: "desc" } });
    await emitBrainEvent("fiverr.search", { gigs: gigs.length, inquiries: inquiries.length });
    return {
      ok: true,
      unavailable: !remote.available,
      output: { remote, gigs, inquiries, note: remote.error },
    };
  }

  private async importGig(payload: Record<string, unknown>): Promise<PlatformAgentResult> {
    const title = String(payload.title ?? "").trim();
    if (!title) return { ok: false, output: null, error: "Gig title is required." };
    const gig = await prisma.gigProfile.create({
      data: {
        platform: "FIVERR",
        title,
        description: payload.description ? String(payload.description) : null,
        keywords: String(payload.keywords ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        packages: (payload.packages ?? []) as Prisma.InputJsonValue,
        faqs: (payload.faqs ?? []) as Prisma.InputJsonValue,
      },
    });
    await remember({
      platform: "fiverr",
      kind: "gig_imported",
      subject: title,
      content: "Gig stored for optimization. No ranking claims were made.",
      metadata: { gigId: gig.id },
    });
    return { ok: true, output: { id: gig.id } };
  }

  private async importInquiry(payload: Record<string, unknown>): Promise<PlatformAgentResult> {
    const message = String(payload.message ?? "").trim();
    if (!message) return { ok: false, output: null, error: "Inquiry message is required." };
    const qualified = qualifyFiverrRequest({
      title: String(payload.title ?? "Fiverr buyer inquiry"),
      message,
      budget: payload.budget ? String(payload.budget) : null,
      buyerName: payload.buyerName ? String(payload.buyerName) : null,
    });
    const opportunity = await prisma.freelanceOpportunity.create({
      data: {
        platform: "FIVERR",
        title: String(payload.title ?? "Fiverr buyer inquiry"),
        description: message,
        clientName: payload.buyerName ? String(payload.buyerName) : null,
        source: "manual_inquiry",
        budget: payload.budget ? String(payload.budget) : null,
        fitScore: qualified.total,
        classification: qualified.classification,
        status: qualified.band === "REJECT" ? "SKIPPED" : "NEW",
        recommendedService: qualified.recommendedService,
        qualifyReasons: qualified.reasons,
        risks: qualified.risks,
        recommendedAction: qualified.recommendedAction,
        recommendedStrategy: qualified.band,
      },
    });
    const inquiry = await prisma.buyerInquiry.create({
      data: {
        platform: "FIVERR",
        opportunityId: opportunity.id,
        buyerName: payload.buyerName ? String(payload.buyerName) : null,
        message,
        status: "NEW",
      },
    });
    return { ok: true, output: { inquiryId: inquiry.id, opportunityId: opportunity.id } };
  }
}

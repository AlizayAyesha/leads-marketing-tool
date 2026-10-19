import "server-only";

import type { OpportunitySource, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { UpworkTool } from "@/lib/tools/upwork";
import { remember } from "@/lib/brain/memory";
import { emitBrainEvent } from "@/lib/brain/events";
import { qualifyOpportunity } from "@/lib/platforms/qualify-core";
import type { PlatformAgent, PlatformAgentResult, PlatformTask } from "@/lib/platforms/types";

const tool = new UpworkTool();

export class UpworkAgent implements PlatformAgent {
  id = "upwork";
  name = "Upwork Agent";
  platform = "upwork";
  capabilities = [
    "find_freelance_opportunities",
    "qualify_freelance_opportunity",
    "prepare_upwork_proposal",
  ] as const;
  permissions = ["read_imported_listings", "draft_proposal", "no_external_submit"];

  async execute(task: PlatformTask): Promise<PlatformAgentResult> {
    if (task.type === "search") return this.search(task.payload ?? {});
    if (task.type === "import") return this.importListing(task.payload ?? {});
    if (task.type === "list") return this.list(task.payload ?? {});
    return { ok: false, output: null, error: `Unknown Upwork task: ${task.type}` };
  }

  private async search(payload: Record<string, unknown>): Promise<PlatformAgentResult> {
    const remote = await tool.searchOpportunities();
    const existing = await prisma.freelanceOpportunity.findMany({
      where: {
        platform: "UPWORK",
        ...(payload.serviceHint
          ? { recommendedService: payload.serviceHint as never }
          : {}),
      },
      orderBy: [{ fitScore: "desc" }, { createdAt: "desc" }],
      take: 20,
    });
    await emitBrainEvent("upwork.search", {
      query: payload.query ?? null,
      stored: existing.length,
      remoteAvailable: remote.available,
    });
    return {
      ok: true,
      unavailable: !remote.available,
      output: {
        remote,
        stored: existing,
        note: remote.error,
      },
    };
  }

  private async importListing(payload: Record<string, unknown>): Promise<PlatformAgentResult> {
    const title = String(payload.title ?? "").trim();
    if (!title) return { ok: false, output: null, error: "Title is required." };
    const description = String(payload.description ?? "") || null;
    const skills = Array.isArray(payload.skills)
      ? payload.skills.map(String)
      : String(payload.skills ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
    const qualified = qualifyOpportunity({
      title,
      description,
      budget: payload.budget ? String(payload.budget) : null,
      skills,
      serviceHint: payload.serviceHint ? String(payload.serviceHint) : null,
    });
    const row = await prisma.freelanceOpportunity.create({
      data: {
        platform: "UPWORK" satisfies OpportunitySource,
        externalId: payload.externalId ? String(payload.externalId) : null,
        title,
        description,
        url: payload.url ? String(payload.url) : null,
        clientName: payload.clientName ? String(payload.clientName) : null,
        budget: payload.budget ? String(payload.budget) : null,
        budgetType: payload.budgetType ? String(payload.budgetType) : null,
        skills,
        location: payload.location ? String(payload.location) : null,
        source: "manual",
        fitScore: qualified.score,
        classification: qualified.classification,
        status: qualified.classification === "SKIP" ? "SKIPPED" : "QUALIFIED",
        recommendedService: qualified.recommendedService,
        recommendedStrategy: qualified.recommendedAction,
        qualifyReasons: qualified.reasons,
        risks: qualified.risks,
        recommendedAction: qualified.recommendedAction,
        rawPayload: payload as Prisma.InputJsonValue,
      },
    });
    const amount = Number(String(payload.budget ?? "").replace(/[^\d.]/g, ""));
    if (Number.isFinite(amount) && amount > 0) {
      await prisma.freelanceOpportunity.update({
        where: { id: row.id },
        data: { budgetAmount: amount },
      });
    }
    await remember({
      platform: "upwork",
      kind: "project_researched",
      subject: title,
      content: `Imported Upwork listing. Score ${qualified.score} (${qualified.classification}).`,
      metadata: { opportunityId: row.id },
    });
    return { ok: true, output: { id: row.id, ...qualified } };
  }

  private async list(payload: Record<string, unknown>) {
    const rows = await prisma.freelanceOpportunity.findMany({
      where: { platform: "UPWORK" },
      orderBy: [{ fitScore: "desc" }, { createdAt: "desc" }],
      take: Number(payload.limit ?? 20),
    });
    return { ok: true, output: rows };
  }
}

import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { remember } from "@/lib/brain/memory";
import { qualifyFiverrRequest } from "@/lib/platforms/fiverr/qualify";
import type { PlatformAgent, PlatformAgentResult, PlatformTask } from "@/lib/platforms/types";

export class FiverrQualificationAgent implements PlatformAgent {
  id = "fiverr_qualify";
  name = "Fiverr Qualification Agent";
  platform = "fiverr";
  capabilities = ["qualify_freelance_opportunity"] as const;
  permissions = ["read_imported_gigs"];

  async execute(task: PlatformTask): Promise<PlatformAgentResult> {
    const id = String(task.payload?.opportunityId ?? "");
    const row = await prisma.freelanceOpportunity.findUnique({ where: { id } });
    if (!row) return { ok: false, output: null, error: "Opportunity not found." };
    const result = qualifyFiverrRequest({
      title: row.title,
      message: row.description ?? row.title,
      budget: row.budget,
      budgetAmount: row.budgetAmount,
      buyerName: row.clientName,
      location: row.location,
    });
    const research =
      row.research && typeof row.research === "object" && !Array.isArray(row.research)
        ? { ...(row.research as Record<string, unknown>), fiverrQualification: result }
        : { fiverrQualification: result };
    await prisma.freelanceOpportunity.update({
      where: { id },
      data: {
        fitScore: result.total,
        classification: result.classification,
        status: result.band === "REJECT" ? "SKIPPED" : "QUALIFIED",
        recommendedService: result.recommendedService,
        recommendedStrategy: result.band,
        recommendedAction: result.recommendedAction,
        qualifyReasons: result.reasons,
        risks: result.risks,
        research: research as Prisma.InputJsonValue,
      },
    });
    await remember({
      platform: "fiverr",
      kind: result.band === "REJECT" ? "project_skipped" : "project_qualified",
      subject: row.title,
      content: `Fiverr ${result.band} · score ${result.total}.`,
      metadata: { opportunityId: id, band: result.band },
    });
    return { ok: true, output: result };
  }
}

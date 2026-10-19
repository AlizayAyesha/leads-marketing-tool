import "server-only";

import { prisma } from "@/lib/db/prisma";
import { remember } from "@/lib/brain/memory";
import { qualifyOpportunity } from "@/lib/platforms/qualify-core";
import type { PlatformAgent, PlatformAgentResult, PlatformTask } from "@/lib/platforms/types";

export class UpworkQualificationAgent implements PlatformAgent {
  id = "upwork_qualification";
  name = "Upwork Qualification Agent";
  platform = "upwork";
  capabilities = ["qualify_freelance_opportunity"] as const;
  permissions = ["read_imported_listings"];

  async execute(task: PlatformTask): Promise<PlatformAgentResult> {
    const id = String(task.payload?.opportunityId ?? "");
    const row = await prisma.freelanceOpportunity.findUnique({ where: { id } });
    if (!row) return { ok: false, output: null, error: "Opportunity not found." };
    const result = qualifyOpportunity({
      title: row.title,
      description: row.description,
      budget: row.budget,
      budgetAmount: row.budgetAmount,
      skills: Array.isArray(row.skills) ? row.skills.map(String) : [],
    });
    await prisma.freelanceOpportunity.update({
      where: { id },
      data: {
        fitScore: result.score,
        classification: result.classification,
        status: result.classification === "SKIP" ? "SKIPPED" : "QUALIFIED",
        recommendedService: result.recommendedService,
        recommendedStrategy: result.recommendedAction,
        qualifyReasons: result.reasons,
        risks: result.risks,
        recommendedAction: result.recommendedAction,
      },
    });
    await remember({
      platform: "upwork",
      kind: result.classification === "SKIP" ? "project_skipped" : "project_qualified",
      subject: row.title,
      content: `Score ${result.score}. ${result.reasons.join(" ")}`,
      metadata: { opportunityId: id, classification: result.classification },
    });
    return { ok: true, output: result };
  }
}

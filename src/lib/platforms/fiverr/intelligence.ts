import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { remember } from "@/lib/brain/memory";
import { inferService } from "@/lib/platforms/qualify-core";
import { qualifyFiverrRequest } from "@/lib/platforms/fiverr/qualify";
import type { PlatformAgent, PlatformAgentResult, PlatformTask } from "@/lib/platforms/types";

const NICHE_RE =
  /\b(whatsapp|hubspot|real estate|crm|chatbot|booking|lead qualif|instagram|tiktok|shopify)\b/gi;

export class FiverrIntelligenceAgent implements PlatformAgent {
  id = "fiverr_intelligence";
  name = "Fiverr Market Intelligence Agent";
  platform = "fiverr";
  capabilities = ["analyze_fiverr_market", "analyze_fiverr_gigs", "find_freelance_opportunities"] as const;
  permissions = ["read_imported_gigs"];

  async execute(_task: PlatformTask): Promise<PlatformAgentResult> {
    const [inquiries, gigs] = await Promise.all([
      prisma.buyerInquiry.findMany({
        where: { platform: "FIVERR" },
        orderBy: { createdAt: "desc" },
        take: 80,
        include: { opportunity: true },
      }),
      prisma.gigProfile.findMany({ where: { platform: "FIVERR" }, take: 40 }),
    ]);

    const clusters = new Map<
      string,
      { count: number; samples: string[]; budgets: number[]; services: string[] }
    >();

    for (const row of inquiries) {
      const text = `${row.opportunity?.title ?? ""} ${row.message}`;
      const service = inferService(text) ?? "UNKNOWN";
      const niches = [...text.matchAll(NICHE_RE)].map((item) => item[0]!.toLowerCase());
      const key = [service, ...[...new Set(niches)].sort()].join("|");
      const bucket = clusters.get(key) ?? { count: 0, samples: [], budgets: [], services: [] };
      bucket.count += 1;
      if (bucket.samples.length < 3) bucket.samples.push(text.slice(0, 180));
      const scored = qualifyFiverrRequest({
        title: row.opportunity?.title,
        message: row.message,
        budget: row.opportunity?.budget,
        budgetAmount: row.opportunity?.budgetAmount,
        buyerName: row.buyerName,
      });
      if (scored.breakdown.budget >= 9 && row.opportunity?.budgetAmount) {
        bucket.budgets.push(row.opportunity.budgetAmount);
      }
      bucket.services.push(service);
      clusters.set(key, bucket);
    }

    const ranked = [...clusters.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const created = [];
    for (const cluster of ranked) {
      if (cluster.count < 1) continue;
      const title = `Market: ${cluster.key.replaceAll("|", " · ").replaceAll("_", " ")}`;
      const existing = await prisma.freelanceOpportunity.findFirst({
        where: { platform: "FIVERR", source: "market_intelligence", title },
        orderBy: { createdAt: "desc" },
      });
      if (existing && Date.now() - existing.createdAt.getTime() < 7 * 24 * 60 * 60 * 1000) {
        created.push({ id: existing.id, reused: true, title });
        continue;
      }
      const avgBudget =
        cluster.budgets.length > 0
          ? Math.round(cluster.budgets.reduce((a, b) => a + b, 0) / cluster.budgets.length)
          : null;
      const sample = cluster.samples[0] ?? "";
      const scored = qualifyFiverrRequest({ title, message: sample, budgetAmount: avgBudget });
      const row = await prisma.freelanceOpportunity.create({
        data: {
          platform: "FIVERR",
          title,
          description: cluster.samples.join("\n---\n"),
          source: "market_intelligence",
          fitScore: scored.total,
          classification: scored.classification,
          status: scored.band === "REJECT" ? "SKIPPED" : "RESEARCHED",
          recommendedService: scored.recommendedService,
          recommendedAction: scored.recommendedAction,
          qualifyReasons: scored.reasons,
          risks: scored.risks,
          budgetAmount: avgBudget,
          budget: avgBudget ? `~$${avgBudget} from imported requests` : null,
          research: {
            kind: "fiverr_market",
            cluster: cluster.key,
            demandCount: cluster.count,
            sampleLanguage: cluster.samples,
            gigCount: gigs.length,
            note: "Built from imported inquiries only. Jarvis did not scrape Fiverr search.",
          } as Prisma.InputJsonValue,
        },
      });
      created.push({ id: row.id, reused: false, title, demandCount: cluster.count, band: scored.band });
    }

    await remember({
      platform: "fiverr",
      kind: "market_intelligence",
      subject: "Fiverr demand clusters",
      content: `Stored ${created.length} market snapshots from imported buyer text. No Fiverr scrape.`,
      metadata: { created },
    });

    return {
      ok: true,
      output: {
        inquiryCount: inquiries.length,
        gigCount: gigs.length,
        clusters: ranked.map((item) => ({ key: item.key, count: item.count })),
        opportunities: created,
        note: "Market intelligence uses imported data only. Official Fiverr search is not connected.",
      },
    };
  }
}

import "server-only";

import { prisma } from "@/lib/db/prisma";
import { actorAllowedInFullScrape, shouldFallbackToConnectedScrapers, shouldRetryActorAttempt } from "@/lib/scraping/pipeline-policy";
import { runConnectedScraperFallback } from "@/lib/scraping/fallback";
import { formatDiscoverOperatorMessage, formatDiscoverSummary, type DiscoverCounters } from "@/lib/scraping/discover-report-types";
import type { ClassifyCounts } from "@/lib/intelligence/persist-opportunity";
import type { SheetSyncResult } from "@/lib/google/sync";

export type PipelineStep = {
  name: string;
  kind: "apify" | "website";
  ok: boolean;
  attempts: number;
  detail: string;
  leadsCreated: number;
};

export type FullScrapeReport = {
  ok: boolean;
  steps: PipelineStep[];
  leadsCreated: number;
  discovery: DiscoverCounters;
  classification: ClassifyCounts;
  priorityOpportunities: number;
  nurtureOpportunities: number;
  rejectedOpportunities: number;
  sheet: SheetSyncResult | null;
  message: string;
};

const emptyClassify = (): ClassifyCounts => ({
  classified: 0,
  newThisRunEvaluated: 0,
  existingUnclassifiedEvaluated: 0,
  priority: 0,
  nurture: 0,
  rejected: 0,
});

export async function runFullScrapeThenSheet(input: {
  url?: string;
  operation?: "scrape" | "crawl";
} = {}): Promise<FullScrapeReport> {
  const steps: PipelineStep[] = [];
  let leadsCreated = 0;
  let duplicates = 0;
  let skippedKnown = 0;
  let skippedPortals = 0;
  let skippedExcluded = 0;
  let failed = 0;
  let apifyQuotaHit = false;
  const startedAt = new Date();

  const actors = await prisma.apifyActor.findMany({
    where: { active: true },
    orderBy: [{ lastRunAt: "asc" }, { displayName: "asc" }],
  });
  const allowed = actors.filter(actorAllowedInFullScrape);

  if (allowed.length) {
    const { runConfiguredActorJob } = await import("@/lib/apify/job");
    for (const actor of allowed) {
      if (apifyQuotaHit) {
        steps.push({
          name: actor.displayName,
          kind: "apify",
          ok: true,
          attempts: 0,
          detail: "Skipped — Apify monthly limit already hit. Connected scrapers continue.",
          leadsCreated: 0,
        });
        continue;
      }
      let lastError = "";
      let created = 0;
      let actorDuplicates = 0;
      let ok = false;
      let attempts = 0;
      while (attempts < 2 && !ok) {
        attempts += 1;
        const report = await runConfiguredActorJob({
          apifyActorId: actor.id,
          testMode: false,
          ingest: true,
          pipeline: false,
          limit: 50,
        }).catch((error) => ({
          actorName: actor.displayName,
          leadsCreated: 0,
          duplicates: 0,
          items: 0,
          error: error instanceof Error ? error.message : String(error),
        }));
        created = report.leadsCreated ?? 0;
        actorDuplicates = report.duplicates ?? 0;
        const removed = "excluded" in report ? Number(report.excluded ?? 0) : 0;
        skippedExcluded += removed;
        const status = "status" in report ? report.status : null;
        if (status === "SUCCEEDED" || !report.error) {
          ok = status === "SUCCEEDED" ? !report.error : true;
          const stillRunning = status === "RUNNING";
          lastError = report.error
            ? report.error
            : stillRunning
              ? `Actor still running. Sync the actor run after it finishes to import results. ${report.items ?? 0} items so far.`
              : `${created} new leads · ${actorDuplicates} duplicates · ${removed} removed (agency/tech) · ${report.items ?? 0} items`;
          break;
        }
        lastError = report.error;
        if (!shouldRetryActorAttempt({ status, error: report.error })) {
          if (/usage hard limit|quota|payment/i.test(report.error)) apifyQuotaHit = true;
          break;
        }
      }
      leadsCreated += created;
      duplicates += actorDuplicates;
      const quotaError = /usage hard limit|quota|payment/i.test(lastError);
      if (!ok && !quotaError) failed += 1;
      steps.push({
        name: actor.displayName,
        kind: "apify",
        ok: ok || quotaError,
        attempts,
        detail: quotaError
          ? `Apify monthly limit. Switching to Firecrawl / HTTP / Chrome / Crawl4AI. ${lastError}`
          : lastError,
        leadsCreated: created,
      });
    }
  } else {
    steps.push({
      name: "Apify actors",
      kind: "apify",
      ok: true,
      attempts: 0,
      detail: "No Maps actors this run. Connected scrapers will discover instead.",
      leadsCreated: 0,
    });
  }

  const url = input.url?.trim();
  if (url) {
    const { runAllZarScrapersAction } = await import("@/lib/actions/scraping");
    const local = await runAllZarScrapersAction({
      url,
      operation: input.operation === "crawl" ? "crawl" : "scrape",
      retryFailures: true,
    }).catch((error) => ({
      status: "FAILED" as const,
      successful: 0,
      totalIngested: 0,
      runs: [] as Array<{ scraper: string; status: string; ingested: number; error: string | null }>,
      error: error instanceof Error ? error.message : String(error),
    }));
    leadsCreated += local.totalIngested ?? 0;
    if ("runs" in local && local.runs.length) {
      for (const run of local.runs) {
        if (run.status !== "COMPLETED") failed += 1;
        steps.push({
          name: run.scraper,
          kind: "website",
          ok: run.status === "COMPLETED",
          attempts: 1,
          detail: run.error ?? `${run.ingested} leads`,
          leadsCreated: run.ingested,
        });
      }
    } else if ("error" in local && local.error) {
      failed += 1;
      steps.push({
        name: "Website engines",
        kind: "website",
        ok: false,
        attempts: 1,
        detail: local.error,
        leadsCreated: 0,
      });
    }
  }

  const apifyLeadsCreated = steps.filter((step) => step.kind === "apify").reduce((sum, step) => sum + step.leadsCreated, 0);
  if (shouldFallbackToConnectedScrapers({ apifyQuotaHit, apifyLeadsCreated })) {
    const fallback = await runConnectedScraperFallback({
      url: input.url,
      operation: input.operation === "crawl" ? "crawl" : "scrape",
    });
    leadsCreated += fallback.leadsCreated;
    duplicates += fallback.duplicates;
    skippedKnown += fallback.skippedKnown;
    skippedPortals += fallback.skippedPortals;
    failed += fallback.failed;
    steps.push(...fallback.steps);
  }

  const discovery: DiscoverCounters = {
    new: leadsCreated,
    duplicates,
    failed,
    skipped: skippedKnown,
    skippedPortals,
    skippedExcluded,
  };

  const { classifyUnclassifiedProductionLeads } = await import("@/lib/intelligence/persist-opportunity");
  const classified = await classifyUnclassifiedProductionLeads(startedAt).catch(() => emptyClassify());
  steps.push({
    name: "Commercial classify",
    kind: "website",
    ok: true,
    attempts: 1,
    detail: [
      classified.newThisRunEvaluated ? `${classified.newThisRunEvaluated} new this run` : null,
      classified.existingUnclassifiedEvaluated
        ? `${classified.existingUnclassifiedEvaluated} existing unclassified`
        : null,
      `${classified.classified} evaluated → ${classified.priority} PRIORITY · ${classified.nurture} NURTURE · ${classified.rejected} REJECT`,
    ]
      .filter(Boolean)
      .join(" · "),
    leadsCreated: 0,
  });

  const { syncLeadsWorkbook } = await import("@/lib/google/sync");
  const sheet = await syncLeadsWorkbook();
  const quota = apifyQuotaHit || steps.some((step) => /usage hard limit|quota|payment/i.test(step.detail));
  const summary = formatDiscoverSummary({ discovery, classification: classified });
  const message = formatDiscoverOperatorMessage({
    summary,
    sheetOk: Boolean(sheet.ok),
    sheetMessage: sheet.message || "The Google Sheet was not updated.",
    quota,
    discoveryNew: discovery.new,
  });

  return {
    ok: true,
    steps,
    leadsCreated,
    discovery,
    classification: classified,
    priorityOpportunities: classified.priority,
    nurtureOpportunities: classified.nurture,
    rejectedOpportunities: classified.rejected,
    sheet,
    message,
  };
}

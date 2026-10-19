"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { cancelScrapingJob, runScrapingJob } from "@/lib/scraping/service";
import type { ScrapingInput, ScrapingOperation } from "@/lib/scraping/types";

const LOCAL_PROVIDERS = ["crawlee", "playwright", "crawl4ai", "firecrawl"];
const FALLBACK_SCRAPER_SLUGS = ["website-http", "website-browser", "website-crawl4ai", "firecrawl"];

function refresh() {
  revalidatePath("/integrations/scraping");
  revalidatePath("/integrations/sheets");
  revalidatePath("/");
  revalidatePath("/outreach");
  revalidatePath("/leads");
  revalidatePath("/research");
}

async function ingestScrapingJobLeads(jobId: string) {
  const evidence = await prisma.scrapedEvidence.findMany({ where: { jobId } });
  if (!evidence.length) return { stored: 0, duplicates: 0 };
  const { ingestLeads } = await import("@/lib/leads/ingest");
  const leads = evidence.map((row) => {
    const fields = (row.normalizedFields ?? {}) as Record<string, unknown>;
    const emails = Array.isArray(fields.emails) ? fields.emails.map(String) : [];
    const phones = Array.isArray(fields.phones) ? fields.phones.map(String) : [];
    return {
      company: String(fields.title ?? row.sourceUrl),
      website: row.sourceUrl,
      email: emails[0] ?? null,
      phone: phones[0] ?? null,
      source: "zar-scrape",
      notes: String(fields.description ?? "").slice(0, 500),
      sourceUrl: row.sourceUrl,
      rawPayload: row.normalizedFields,
    };
  });
  return ingestLeads({ leads, sourceName: "zar-scrape" });
}

async function requireSheetSync() {
  const { syncLeadsWorkbook } = await import("@/lib/google/sync");
  const sheet = await syncLeadsWorkbook();
  if (!sheet.ok) {
    throw new Error(sheet.message);
  }
  return sheet;
}

export async function listZarScrapers() {
  return prisma.scraperDefinition.findMany({
    where: { enabled: true, provider: { in: LOCAL_PROVIDERS } },
    orderBy: { name: "asc" },
    select: { slug: true, name: true, provider: true },
  });
}

export async function runZarScrapeAction(input: {
  url: string;
  scraper: string;
  operation?: ScrapingOperation;
}) {
  const url = new URL(String(input.url ?? "").trim());
  const operation = input.operation === "crawl" ? "crawl" : "scrape";
  const job = await runScrapingJob({
    scraper: input.scraper || "website-http",
    operation,
    input: {
      urls: [url.toString()],
      allowedDomains: [url.hostname],
      maxRequests: operation === "crawl" ? 10 : 1,
    },
    createdBy: "operator-home",
  });
  if (job.status !== "COMPLETED") {
    refresh();
    return {
      status: job.status,
      recordsFound: job.recordsFound,
      recordsStored: job.recordsStored,
      scraper: job.scraper.name,
      error: job.error ?? "Scrape did not complete.",
      sheet: null,
    };
  }
  const ingested = await ingestScrapingJobLeads(job.id);
  const sheet = await requireSheetSync();
  refresh();
  return {
    status: job.status,
    recordsFound: job.recordsFound,
    recordsStored: job.recordsStored,
    scraper: job.scraper.name,
    error: null,
    ingested: ingested.stored,
    sheet,
  };
}

export async function runAllZarScrapersAction(input: {
  url: string;
  operation?: ScrapingOperation;
  retryFailures?: boolean;
}) {
  const url = new URL(String(input.url ?? "").trim());
  const operation = input.operation === "crawl" ? "crawl" : "scrape";
  const scrapers = await prisma.scraperDefinition.findMany({
    where: { enabled: true, slug: { in: FALLBACK_SCRAPER_SLUGS }, provider: { in: LOCAL_PROVIDERS } },
    select: { slug: true, name: true },
  });
  const bySlug = new Map(scrapers.map((scraper) => [scraper.slug, scraper]));
  const ordered = FALLBACK_SCRAPER_SLUGS.map((slug) => bySlug.get(slug)).filter((scraper): scraper is NonNullable<typeof scraper> =>
    Boolean(scraper),
  );
  if (!ordered.length) throw new Error("No local website scrapers are enabled.");

  const runs: Array<{
    scraper: string;
    status: string;
    recordsFound: number;
    recordsStored: number;
    ingested: number;
    duplicates: number;
    error: string | null;
  }> = [];
  let totalIngested = 0;
  let totalDuplicates = 0;

  for (const scraper of ordered) {
    let attempt = 0;
    let completed = false;
    const maxAttempts = input.retryFailures === false ? 1 : 2;
    while (!completed && attempt < maxAttempts) {
      attempt += 1;
      try {
        const job = await runScrapingJob({
          scraper: scraper.slug,
          operation,
          input: {
            urls: [url.toString()],
            allowedDomains: [url.hostname],
            maxRequests: operation === "crawl" ? 10 : 1,
          },
          createdBy: attempt > 1 ? "operator-run-all-retry" : "operator-run-all",
        });
        const ingested = job.status === "COMPLETED" ? await ingestScrapingJobLeads(job.id) : { stored: 0, duplicates: 0 };
        totalIngested += ingested.stored;
        totalDuplicates += ingested.duplicates;
        runs.push({
          scraper: job.scraper.name,
          status: job.status,
          recordsFound: job.recordsFound,
          recordsStored: job.recordsStored,
          ingested: ingested.stored,
          duplicates: ingested.duplicates,
          error: job.error ?? null,
        });
        completed = job.status === "COMPLETED";
        if (completed) break;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Scrape failed.";
        if (attempt >= maxAttempts) {
          runs.push({
            scraper: scraper.name,
            status: "FAILED",
            recordsFound: 0,
            recordsStored: 0,
            ingested: 0,
            duplicates: 0,
            error: message,
          });
        }
      }
    }
    if (completed) break;
  }

  const successful = runs.filter((run) => run.status === "COMPLETED").length;
  const sheet = successful ? await requireSheetSync() : null;
  refresh();
  return {
    status: successful ? "COMPLETED" : "FAILED",
    successful,
    failed: runs.filter((run) => run.status !== "COMPLETED").length,
    totalIngested,
    totalDuplicates,
    runs,
    sheet,
  };
}

export async function startScrapingAction(form: FormData) {
  const rawUrl = String(form.get("url") ?? "").trim();
  const scraper = String(form.get("scraper") ?? "website-http");
  const operation = String(form.get("operation") ?? "scrape") as ScrapingOperation;
  await runZarScrapeAction({ url: rawUrl, scraper, operation });
}

export async function cancelScrapingAction(form: FormData) {
  await cancelScrapingJob(String(form.get("jobId") ?? ""));
  refresh();
}

export async function retryScrapingAction(form: FormData) {
  const job = await prisma.scrapingJob.findUnique({
    where: { id: String(form.get("jobId") ?? "") },
    include: { scraper: true },
  });
  if (job) {
    const next = await runScrapingJob({
      scraper: job.scraper.slug,
      operation: job.operation as ScrapingOperation,
      input: job.input as unknown as ScrapingInput,
      createdBy: "operator-retry",
    });
    if (next.status === "COMPLETED") {
      await ingestScrapingJobLeads(next.id);
      await requireSheetSync();
    }
  }
  refresh();
}

export async function runFullScrapeThenSheetAction(input: { url?: string; operation?: "scrape" | "crawl" } = {}) {
  const { runFullScrapeThenSheet } = await import("@/lib/scraping/full-pipeline");
  const report = await runFullScrapeThenSheet(input);
  refresh();
  return report;
}

import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { getScraperProvider } from "@/lib/scraping/registry";
import type { ScrapingInput, ScrapingOperation } from "@/lib/scraping/types";

const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function runScrapingJob(input: { scraper: string; operation?: ScrapingOperation; input: ScrapingInput; createdBy?: string }) {
  const scraper = await prisma.scraperDefinition.findUnique({ where: { slug: input.scraper } });
  if (!scraper || !scraper.enabled) throw new Error("Scraper is missing or disabled.");
  const operation = input.operation ?? "scrape";
  if (!["scrape", "crawl", "search", "extract"].includes(operation)) throw new Error("Unsupported scraping operation.");
  const job = await prisma.scrapingJob.create({ data: { scraperId: scraper.id, provider: scraper.provider, operation, input: json(input.input), createdBy: input.createdBy, status: "RUNNING", startedAt: new Date() } });
  try {
    const provider = await getScraperProvider(scraper.provider);
    const result = await provider[operation](input.input);
    let stored = 0;
    for (const record of result.records) {
      const fingerprint = createHash("sha256").update(`${record.sourceUrl}\n${JSON.stringify(record.normalizedFields)}`).digest("hex");
      const duplicate = await prisma.scrapedEvidence.findUnique({ where: { fingerprint }, select: { id: true } });
      if (duplicate) continue;
      try {
        await prisma.scrapedEvidence.create({ data: { jobId: job.id, sourceUrl: record.sourceUrl, sourceType: record.sourceType, rawEvidence: json(record.rawEvidence), normalizedFields: json(record.normalizedFields), extractionConfidence: record.extractionConfidence, scraper: scraper.slug, provider: scraper.provider, fingerprint } });
        stored += 1;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
    return prisma.scrapingJob.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date(), recordsFound: result.records.length, recordsStored: stored, scraper: { update: { lastRunAt: new Date(), status: "READY" } } }, include: { evidence: true, scraper: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scraping failed.";
    await prisma.scrapingJob.update({ where: { id: job.id }, data: { status: "FAILED", completedAt: new Date(), error: message } });
    throw error;
  }
}

export async function getScrapingJob(id: string) { return prisma.scrapingJob.findUnique({ where: { id }, include: { scraper: true, evidence: true } }); }
export async function cancelScrapingJob(id: string) {
  const job = await prisma.scrapingJob.findUnique({ where: { id } });
  if (!job) return null;
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return job;
  return prisma.scrapingJob.update({ where: { id }, data: { cancelRequested: true, status: "CANCELLED", completedAt: new Date() } });
}
export async function searchScrapedData(query: string, limit = 10) {
  return prisma.scrapedEvidence.findMany({ where: { OR: [{ sourceUrl: { contains: query, mode: "insensitive" } }, { sourceType: { contains: query, mode: "insensitive" } }] }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 50), include: { job: { select: { id: true, status: true } } } });
}

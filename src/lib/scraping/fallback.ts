import "server-only";

import { prisma } from "@/lib/db/prisma";
import { ingestLeads } from "@/lib/leads/ingest";
import { getBusinessPolicy } from "@/lib/config/business-store";
import { getSetting, setSetting } from "@/lib/db/settings";
import { FirecrawlProvider } from "@/lib/scraping/providers/firecrawl";
import { runScrapingJob } from "@/lib/scraping/service";
import { getDiscoverSeedBrief } from "@/lib/campaigns/active-brief";
import { FALLBACK_QUERY_CURSOR_KEY, rotatedFallbackQueries } from "@/lib/scraping/fallback-queries";
import { loadKnownProductionHosts, normalizeWebsiteHost } from "@/lib/scraping/known-host";
import { isNonBuyerDiscoveryHost } from "@/lib/scraping/non-buyer-host";

export type FallbackStep = {
  name: string;
  kind: "website";
  ok: boolean;
  attempts: number;
  detail: string;
  leadsCreated: number;
};

export type FallbackReport = {
  steps: FallbackStep[];
  leadsCreated: number;
  duplicates: number;
  skippedKnown: number;
  skippedPortals: number;
  failed: number;
};

const LOCAL_PROVIDERS = ["crawlee", "playwright", "crawl4ai", "firecrawl"];

function titleToCompany(title: unknown, url: string) {
  const text = String(title ?? "").trim();
  if (text) return text.split(/[|•-]/)[0]?.trim() || text;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function ingestJobEvidence(jobId: string) {
  const evidence = await prisma.scrapedEvidence.findMany({ where: { jobId } });
  if (!evidence.length) return { stored: 0, duplicates: 0 };
  return ingestLeads({
    leads: evidence.map((row) => {
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
    }),
    sourceName: "zar-scrape",
  });
}

export async function runConnectedScraperFallback(input: {
  url?: string;
  operation?: "scrape" | "crawl";
}): Promise<FallbackReport> {
  const steps: FallbackStep[] = [];
  let leadsCreated = 0;
  let duplicates = 0;
  let skippedKnown = 0;
  let skippedPortals = 0;
  let failed = 0;
  const urls: string[] = [];
  if (input.url?.trim()) urls.push(input.url.trim());

  const firecrawlEnabled = await prisma.scraperDefinition.findFirst({
    where: { enabled: true, provider: "firecrawl" },
  });
  if (firecrawlEnabled || process.env.FIRECRAWL_API_KEY?.trim()) {
    try {
      const policy = await getBusinessPolicy();
      const brief = await getDiscoverSeedBrief();
      const cursor = Number(await getSetting<number>(FALLBACK_QUERY_CURSOR_KEY, 0)) || 0;
      const queries = rotatedFallbackQueries(policy, cursor, brief);
      await setSetting(FALLBACK_QUERY_CURSOR_KEY, cursor + queries.length);
      const provider = new FirecrawlProvider();
      const leads: Parameters<typeof ingestLeads>[0]["leads"] = [];
      const seen = new Set<string>();
      for (const query of queries) {
        const result = await provider.search({ query, maxRequests: 8 });
        for (const record of result.records) {
          if (!record.sourceUrl || seen.has(record.sourceUrl)) continue;
          seen.add(record.sourceUrl);
          if (isNonBuyerDiscoveryHost(record.sourceUrl)) {
            skippedPortals += 1;
            continue;
          }
          urls.push(record.sourceUrl);
          leads.push({
            company: titleToCompany(record.normalizedFields.title, record.sourceUrl),
            website: record.sourceUrl,
            source: "firecrawl_fallback_search",
            sourceActor: "firecrawl",
            sourceUrl: record.sourceUrl,
            notes: String(record.normalizedFields.description ?? record.normalizedFields.snippet ?? "").slice(0, 500),
          });
        }
      }
      const ingested = await ingestLeads({ leads, sourceName: "firecrawl_fallback_search" });
      leadsCreated += ingested.stored;
      duplicates += ingested.duplicates;
      skippedPortals += ingested.skippedNonBuyer;
      steps.push({
        name: "Firecrawl search",
        kind: "website",
        ok: true,
        attempts: 1,
        detail: `${ingested.stored} new · ${ingested.duplicates} duplicates · ${skippedPortals} listing portals skipped · ${queries.length} queries (${queries[0]} …)`,
        leadsCreated: ingested.stored,
      });
    } catch (error) {
      failed += 1;
      steps.push({
        name: "Firecrawl search",
        kind: "website",
        ok: false,
        attempts: 1,
        detail: error instanceof Error ? error.message : "Firecrawl search failed.",
        leadsCreated: 0,
      });
    }
  }

  const providerOrder = ["crawlee", "crawl4ai", "playwright", "firecrawl"];
  const scrapers = (
    await prisma.scraperDefinition.findMany({
      where: { enabled: true, provider: { in: LOCAL_PROVIDERS } },
      select: { slug: true, name: true, provider: true },
    })
  ).sort((a, b) => providerOrder.indexOf(a.provider) - providerOrder.indexOf(b.provider));
  const uniqueUrls = [...new Set(urls)].slice(0, 8);
  if (!scrapers.length) {
    failed += 1;
    steps.push({
      name: "Connected scrapers",
      kind: "website",
      ok: false,
      attempts: 0,
      detail: "No local scrapers are enabled. Turn on HTTP / Browser / Crawl4AI / Firecrawl under Elite Lead Engine.",
      leadsCreated: 0,
    });
    return { steps, leadsCreated, duplicates, skippedKnown, skippedPortals, failed };
  }
  if (!uniqueUrls.length) {
    const allPortals = skippedPortals > 0;
    steps.push({
      name: "Connected scrapers",
      kind: "website",
      ok: allPortals || leadsCreated > 0,
      attempts: 0,
      detail: allPortals
        ? `No company websites to crawl. ${skippedPortals} listing portals skipped.`
        : "No target URLs yet. Firecrawl search found none, and Discover was run without a website URL.",
      leadsCreated: 0,
    });
    if (!allPortals && leadsCreated === 0) failed += 1;
    return { steps, leadsCreated, duplicates, skippedKnown, skippedPortals, failed };
  }

  const knownHosts = await loadKnownProductionHosts(uniqueUrls.map((url) => normalizeWebsiteHost(url) ?? url));
  const operation = input.operation === "crawl" ? "crawl" : "scrape";
  let jobs = 0;
  for (const target of uniqueUrls) {
    if (jobs >= 12) break;
    const host = normalizeWebsiteHost(target);
    if (!host) continue;

    if (isNonBuyerDiscoveryHost(target)) {
      skippedPortals += 1;
      steps.push({
        name: "SKIPPED_LISTING_PORTAL",
        kind: "website",
        ok: true,
        attempts: 0,
        detail: `${host} is a listing portal or social index, not a buyer company`,
        leadsCreated: 0,
      });
      continue;
    }

    const known = knownHosts.get(host);
    if (known) {
      skippedKnown += 1;
      steps.push({
        name: "SKIPPED_KNOWN_URL",
        kind: "website",
        ok: true,
        attempts: 0,
        detail: `${host} already ingested (${known.leadId}${known.company ? ` · ${known.company}` : ""})`,
        leadsCreated: 0,
      });
      continue;
    }

    for (const scraper of scrapers) {
      try {
        jobs += 1;
        const job = await runScrapingJob({
          scraper: scraper.slug,
          operation,
          input: { urls: [target], allowedDomains: [host], maxRequests: operation === "crawl" ? 8 : 1 },
          createdBy: "apify-quota-fallback",
        });
        const ingested = job.status === "COMPLETED" ? await ingestJobEvidence(job.id) : { stored: 0, duplicates: 0 };
        leadsCreated += ingested.stored;
        duplicates += ingested.duplicates;
        steps.push({
          name: `${scraper.name} · ${host}`,
          kind: "website",
          ok: job.status === "COMPLETED",
          attempts: 1,
          detail: job.error ?? `${ingested.stored} new leads`,
          leadsCreated: ingested.stored,
        });
        if (job.status === "COMPLETED") break;
      } catch (error) {
        steps.push({
          name: `${scraper.name} · ${host}`,
          kind: "website",
          ok: true,
          attempts: 1,
          detail: `Engine skipped after error; next scraper continues. ${error instanceof Error ? error.message : "Scrape failed."}`,
          leadsCreated: 0,
        });
      }
    }
  }

  return { steps, leadsCreated, duplicates, skippedKnown, skippedPortals, failed };
}

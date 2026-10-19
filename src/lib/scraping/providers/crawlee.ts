import "server-only";

import { assertScrapingEnabled, boundedInput, validateScrapingTarget } from "@/lib/scraping/safety";
import { fetchPublicPages } from "@/lib/scraping/providers/http-fetch";
import type { ScrapedRecord, ScraperProvider, ScraperProviderResult, ScrapingInput } from "@/lib/scraping/types";

export class CrawleeProvider implements ScraperProvider {
  readonly id = "crawlee";

  private async run(input: ScrapingInput, followLinks: boolean): Promise<ScraperProviderResult> {
    if (process.env.CRAWLEE_IN_NEXT !== "true") {
      return { records: await fetchPublicPages(input) };
    }
    try {
      return await this.runCrawlee(input, followLinks);
    } catch {
      return { records: await fetchPublicPages(input) };
    }
  }

  private async runCrawlee(input: ScrapingInput, followLinks: boolean): Promise<ScraperProviderResult> {
    assertScrapingEnabled();
    const safe = boundedInput(input);
    const urls = await Promise.all((safe.urls ?? []).map((url) => validateScrapingTarget(url, safe.allowedDomains)));
    if (!urls.length) throw new Error("At least one public URL is required.");
    const { CheerioCrawler } = await import("@crawlee/cheerio");
    const { Configuration, log } = await import("@crawlee/core");
    const records: ScrapedRecord[] = [];
    log.setLevel(log.LEVELS.WARNING);
    const crawler = new CheerioCrawler(
      {
        maxConcurrency: safe.maxConcurrency,
        maxRequestsPerCrawl: safe.maxRequests,
        sameDomainDelaySecs: safe.requestDelayMs / 1000,
        requestHandlerTimeoutSecs: Math.ceil(safe.timeoutMs / 1000),
        maxRequestRetries: safe.retryLimit,
        respectRobotsTxtFile: true,
        async requestHandler({ request, $, enqueueLinks }) {
          const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 20000);
          const title = $("title").text().trim() || null;
          const description = $('meta[name="description"]').attr("content")?.trim() || null;
          const emails = [...new Set((text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []).slice(0, 20))];
          const phones = [...new Set((text.match(/\+?[\d][\d\s().-]{7,}\d/g) ?? []).slice(0, 20))];
          records.push({
            sourceUrl: request.loadedUrl ?? request.url,
            sourceType: "website",
            rawEvidence: { title, description, text },
            normalizedFields: { title, description, emails, phones },
            extractionConfidence: 0.75,
          });
          if (followLinks && Number(request.userData.depth ?? 0) < 1) {
            await enqueueLinks({
              strategy: "same-hostname",
              transformRequestFunction: (next) => ({ ...next, userData: { depth: 1 } }),
            });
          }
        },
      },
      new Configuration({ persistStorage: false }),
    );
    await crawler.run(urls.map((url) => ({ url, userData: { depth: 0 } })));
    return { records };
  }

  scrape(input: ScrapingInput) {
    return this.run(input, false);
  }
  crawl(input: ScrapingInput) {
    return this.run(input, true);
  }
  extract(input: ScrapingInput) {
    return this.run(input, false);
  }
  async search(): Promise<ScraperProviderResult> {
    throw new Error("Crawlee does not invent a search source. Supply public URLs or configure Firecrawl search.");
  }
}

import "server-only";

import { Configuration, log } from "@crawlee/core";
import { PlaywrightCrawler } from "@crawlee/playwright";

import { playwrightLaunchOptions } from "@/lib/scraping/chrome";
import { fetchPublicPages } from "@/lib/scraping/providers/http-fetch";
import { assertScrapingEnabled, boundedInput, validateScrapingTarget } from "@/lib/scraping/safety";
import type { ScrapedRecord, ScraperProvider, ScraperProviderResult, ScrapingInput } from "@/lib/scraping/types";

export class PlaywrightScrapingProvider implements ScraperProvider {
  readonly id = "playwright";

  private async run(input: ScrapingInput, followLinks: boolean): Promise<ScraperProviderResult> {
    assertScrapingEnabled();
    try {
      return await this.runBrowser(input, followLinks);
    } catch {
      return { records: await fetchPublicPages(input) };
    }
  }

  private async runBrowser(input: ScrapingInput, followLinks: boolean): Promise<ScraperProviderResult> {
    const safe = boundedInput(input);
    const urls = await Promise.all((safe.urls ?? []).map((url) => validateScrapingTarget(url, safe.allowedDomains)));
    if (!urls.length) throw new Error("At least one public URL is required.");
    const records: ScrapedRecord[] = [];
    log.setLevel(log.LEVELS.WARNING);
    const crawler = new PlaywrightCrawler(
      {
        maxConcurrency: safe.maxConcurrency,
        maxRequestsPerCrawl: safe.maxRequests,
        sameDomainDelaySecs: safe.requestDelayMs / 1000,
        requestHandlerTimeoutSecs: Math.ceil(safe.timeoutMs / 1000),
        maxRequestRetries: safe.retryLimit,
        respectRobotsTxtFile: true,
        launchContext: { launchOptions: playwrightLaunchOptions() },
        async requestHandler({ request, page, enqueueLinks }) {
          const content = await page.locator("body").innerText().catch(() => "");
          const title = (await page.title().catch(() => "")) || null;
          const description = await page.locator('meta[name="description"]').getAttribute("content").catch(() => null);
          const text = content.replace(/\s+/g, " ").trim().slice(0, 20000);
          records.push({
            sourceUrl: request.loadedUrl ?? request.url,
            sourceType: "website",
            rawEvidence: { title, description, text },
            normalizedFields: { title, description },
            extractionConfidence: 0.8,
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
    if (!records.length) throw new Error("Playwright returned no records.");
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
    throw new Error("Playwright requires target URLs; it does not bypass search-provider access controls.");
  }
}

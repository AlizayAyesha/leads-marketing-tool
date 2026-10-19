import "server-only";

import type { ScraperProvider } from "@/lib/scraping/types";

export async function getScraperProvider(id: string): Promise<ScraperProvider> {
  if (id === "crawlee") {
    const { CrawleeProvider } = await import("@/lib/scraping/providers/crawlee");
    return new CrawleeProvider();
  }
  if (id === "playwright") {
    const { PlaywrightScrapingProvider } = await import("@/lib/scraping/providers/playwright");
    return new PlaywrightScrapingProvider();
  }
  if (id === "firecrawl") {
    const { FirecrawlProvider } = await import("@/lib/scraping/providers/firecrawl");
    return new FirecrawlProvider();
  }
  if (id === "crawl4ai") {
    const { Crawl4AIProvider } = await import("@/lib/scraping/providers/crawl4ai");
    return new Crawl4AIProvider();
  }
  throw new Error(`Scraping provider ${id} is not locally executable.`);
}

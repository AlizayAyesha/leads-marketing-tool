import "server-only";

import { fetchPublicPage } from "@/lib/scraping/providers/http-fetch";
import { parseFirecrawlSearchPayload } from "@/lib/scraping/providers/firecrawl-parse";
import { assertScrapingEnabled, boundedInput, validateScrapingTarget } from "@/lib/scraping/safety";
import type { ScraperProvider, ScraperProviderResult, ScrapingInput } from "@/lib/scraping/types";

export class FirecrawlProvider implements ScraperProvider {
  readonly id = "firecrawl";

  private async request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    assertScrapingEnabled();
    const key = process.env.FIRECRAWL_API_KEY?.trim();
    if (!key) throw new Error("Firecrawl is optional and not configured. Set FIRECRAWL_API_KEY.");
    const base = (process.env.FIRECRAWL_API_URL || "https://api.firecrawl.dev").replace(/\/$/, "");
    const response = await fetch(`${base}/v2/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(`Firecrawl failed (${response.status}): ${String(data.error ?? "request failed")}`);
    return data;
  }

  async scrape(input: ScrapingInput): Promise<ScraperProviderResult> {
    const safe = boundedInput(input);
    const url = await validateScrapingTarget(safe.urls?.[0] ?? "", safe.allowedDomains);
    try {
      const response = await this.request("scrape", { url, formats: ["markdown", "links"], storeInCache: false });
      const data = (response.data ?? {}) as Record<string, unknown>;
      return {
        records: [
          {
            sourceUrl: url,
            sourceType: "website",
            rawEvidence: data,
            normalizedFields: { title: data.title ?? null, markdown: data.markdown ?? null, links: data.links ?? [] },
            extractionConfidence: 0.8,
          },
        ],
      };
    } catch {
      return { records: [await fetchPublicPage(url, safe.allowedDomains)] };
    }
  }
  crawl(input: ScrapingInput) {
    return this.scrape(input);
  }
  extract(input: ScrapingInput) {
    return this.scrape(input);
  }
  async search(input: ScrapingInput): Promise<ScraperProviderResult> {
    if (!input.query?.trim()) throw new Error("A search query is required.");
    const response = await this.request("search", { query: input.query, limit: boundedInput(input).maxRequests });
    const rows = parseFirecrawlSearchPayload(response);
    return {
      records: rows
        .map((row) => {
          const item = row as Record<string, unknown>;
          return {
            sourceUrl: String(item.url ?? item.link ?? ""),
            sourceType: "search_result",
            rawEvidence: item,
            normalizedFields: item,
            extractionConfidence: 0.65,
          };
        })
        .filter((row) => row.sourceUrl),
    };
  }
}

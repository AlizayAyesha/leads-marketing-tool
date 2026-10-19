export type ScrapingOperation = "scrape" | "crawl" | "search" | "extract";

export type ScrapingInput = {
  urls?: string[];
  query?: string;
  allowedDomains?: string[];
  maxRequests?: number;
  maxConcurrency?: number;
  requestDelayMs?: number;
  timeoutMs?: number;
  retryLimit?: number;
};

export type ScrapedRecord = {
  sourceUrl: string;
  sourceType: string;
  rawEvidence: Record<string, unknown>;
  normalizedFields: Record<string, unknown>;
  extractionConfidence: number;
};

export type ScraperProviderResult = { records: ScrapedRecord[] };

export interface ScraperProvider {
  readonly id: string;
  scrape(input: ScrapingInput): Promise<ScraperProviderResult>;
  crawl(input: ScrapingInput): Promise<ScraperProviderResult>;
  search(input: ScrapingInput): Promise<ScraperProviderResult>;
  extract(input: ScrapingInput): Promise<ScraperProviderResult>;
}

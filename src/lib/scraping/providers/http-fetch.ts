import "server-only";

import { assertScrapingEnabled, boundedInput, validateScrapingTarget } from "@/lib/scraping/safety";
import type { ScrapedRecord, ScrapingInput } from "@/lib/scraping/types";

function htmlToText(html: string) {
  const without = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const title = without.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").trim() || null;
  const description =
    without.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ||
    without.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1]?.trim() ||
    null;
  const text = without.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 20000);
  const emails = [...new Set((text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []).slice(0, 20))];
  const phones = [...new Set((text.match(/\+?[\d][\d\s().-]{7,}\d/g) ?? []).slice(0, 20))];
  return { title, description, text, emails, phones };
}

export async function fetchPublicPage(url: string, allowedDomains: string[] = []): Promise<ScrapedRecord> {
  assertScrapingEnabled();
  const safe = await validateScrapingTarget(url, allowedDomains);
  const response = await fetch(safe, {
    redirect: "follow",
    cache: "no-store",
    headers: { "user-agent": "LeadsMarketingTool/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Website fetch failed (${response.status}) for ${safe}`);
  const html = await response.text();
  const parsed = htmlToText(html);
  return {
    sourceUrl: response.url || safe,
    sourceType: "website",
    rawEvidence: { title: parsed.title, description: parsed.description, text: parsed.text },
    normalizedFields: {
      title: parsed.title,
      description: parsed.description,
      emails: parsed.emails,
      phones: parsed.phones,
    },
    extractionConfidence: 0.7,
  };
}

export async function fetchPublicPages(input: ScrapingInput): Promise<ScrapedRecord[]> {
  const safe = boundedInput(input);
  const urls = await Promise.all((safe.urls ?? []).map((url) => validateScrapingTarget(url, safe.allowedDomains)));
  const records: ScrapedRecord[] = [];
  for (const url of urls.slice(0, safe.maxRequests)) {
    records.push(await fetchPublicPage(url, safe.allowedDomains));
  }
  return records;
}

import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { fetchPublicPage } from "@/lib/scraping/providers/http-fetch";
import { boundedInput, validateScrapingTarget } from "@/lib/scraping/safety";
import type { ScrapedRecord, ScraperProvider, ScraperProviderResult, ScrapingInput } from "@/lib/scraping/types";

const runFile = promisify(execFile);

function crawl4aiPython() {
  const fromEnv = process.env.CRAWL4AI_PYTHON?.trim();
  if (fromEnv) return fromEnv;
  const local = path.join(process.cwd(), ".venv-crawl4ai", "bin", "python");
  if (existsSync(local)) return local;
  return "python3";
}

function crawl4aiScript() {
  return path.join(process.cwd(), "scripts", "crawl4ai_chrome.py");
}

function extractTextFields(text: string) {
  const title = text.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").trim() || null;
  const emails = [...new Set((text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []).slice(0, 20))];
  const phones = [...new Set((text.match(/\+?[\d][\d\s().-]{7,}\d/g) ?? []).slice(0, 20))];
  return { title, markdown: text.slice(0, 50000), emails, phones };
}

async function runCrawl4AIChrome(url: string) {
  const python = crawl4aiPython();
  const script = crawl4aiScript();
  if (!existsSync(script)) throw new Error("Crawl4AI helper script is missing.");
  const { stdout } = await runFile(python, [script, url], {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 90000,
    env: { ...process.env, PLAYWRIGHT_CHANNEL: "chrome" },
  });
  const parsed = JSON.parse(stdout.trim() || "{}") as { ok?: boolean; markdown?: string; error?: string | null };
  const markdown = String(parsed.markdown ?? "").trim();
  if (!markdown) throw new Error(parsed.error || "Crawl4AI returned empty markdown.");
  return markdown;
}

async function pageMarkdown(url: string, allowedDomains: string[]) {
  try {
    return await runCrawl4AIChrome(url);
  } catch {
    const page = await fetchPublicPage(url, allowedDomains);
    const fields = page.normalizedFields;
    return [`# ${String(fields.title ?? url)}`, String(fields.description ?? ""), String(fields.text ?? "")]
      .filter(Boolean)
      .join("\n\n");
  }
}

export class Crawl4AIProvider implements ScraperProvider {
  readonly id = "crawl4ai";

  private async run(input: ScrapingInput): Promise<ScraperProviderResult> {
    const safe = boundedInput(input);
    const urls = await Promise.all((safe.urls ?? []).map((url) => validateScrapingTarget(url, safe.allowedDomains ?? [])));
    if (!urls.length) throw new Error("At least one public URL is required.");
    const records: ScrapedRecord[] = [];
    for (const url of urls.slice(0, safe.maxRequests)) {
      const markdown = await pageMarkdown(url, safe.allowedDomains ?? []);
      records.push({
        sourceUrl: url,
        sourceType: "website",
        rawEvidence: { markdown },
        normalizedFields: extractTextFields(markdown),
        extractionConfidence: 0.78,
      });
    }
    return { records };
  }

  scrape(input: ScrapingInput) {
    return this.run(input);
  }

  crawl(input: ScrapingInput) {
    return this.run(input);
  }

  extract(input: ScrapingInput) {
    return this.run(input);
  }

  async search(): Promise<ScraperProviderResult> {
    throw new Error("Crawl4AI reads target URLs. Use Firecrawl search or Maps discovery to find new businesses first.");
  }
}

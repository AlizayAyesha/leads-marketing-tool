import "server-only";

import * as cheerio from "cheerio";

import type { WebsiteSnapshot } from "@/types";
import type { DataSourceAdapter, DataSourceResult } from "@/lib/data-sources/types";
import { extractLinkedInUrlsFromHtml } from "@/lib/enrichment/website-linkedin";

const TECH_HINTS: { needle: string; label: string }[] = [
  { needle: "wp-content", label: "WordPress" },
  { needle: "_next/", label: "Next.js" },
  { needle: "__NEXT_DATA__", label: "Next.js" },
  { needle: "cdn.shopify.com", label: "Shopify" },
  { needle: "wix.com", label: "Wix" },
  { needle: "squarespace", label: "Squarespace" },
  { needle: "webflow", label: "Webflow" },
  { needle: "gtm.js", label: "Google Tag Manager" },
  { needle: "googletagmanager", label: "Google Tag Manager" },
  { needle: "react", label: "React" },
  { needle: "vue.runtime", label: "Vue" },
];

const hostLocks = new Map<string, Promise<void>>();

async function withHostLock<T>(host: string, fn: () => Promise<T>) {
  const previous = hostLocks.get(host) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  hostLocks.set(
    host,
    previous.then(() => current),
  );
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (hostLocks.get(host) === current) hostLocks.delete(host);
  }
}

export class WebsiteResearchAdapter
  implements DataSourceAdapter<{ url: string }, WebsiteSnapshot>
{
  readonly id = "website-research";
  readonly phase = 1 as const;
  readonly configured = true;

  async acquire(input: {
    url: string;
  }): Promise<DataSourceResult<WebsiteSnapshot>> {
    const requestedUrl = input.url;
    let host = "unknown";
    try {
      host = new URL(requestedUrl).host;
    } catch {
      return {
        adapter: this.id,
        sourceUrls: [requestedUrl],
        data: emptySnapshot(requestedUrl, "Invalid website URL"),
      };
    }

    const data = await withHostLock(host, () => fetchSnapshot(requestedUrl));
    return {
      adapter: this.id,
      data,
      sourceUrls: [data.finalUrl || requestedUrl],
    };
  }
}

function emptySnapshot(url: string, error: string): WebsiteSnapshot {
  return {
    requestedUrl: url,
    finalUrl: null,
    statusCode: null,
    title: null,
    description: null,
    h1: [],
    generator: null,
    hasViewport: false,
    techHints: [],
    copyright: null,
    error,
    fetchedAt: new Date().toISOString(),
    linkedinUrls: [],
  };
}

async function fetchSnapshot(url: string): Promise<WebsiteSnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "LeadsMarketingToolResearch/1.0 (public-page research)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ...emptySnapshot(url, `Public fetch blocked with HTTP ${response.status}`),
        statusCode: response.status,
        finalUrl: response.url,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return {
        ...emptySnapshot(url, `Unsupported content type: ${contentType || "unknown"}`),
        statusCode: response.status,
        finalUrl: response.url,
      };
    }

    const html = (await response.text()).slice(0, 400_000);
    const $ = cheerio.load(html);
    const title = $("title").first().text().trim() || null;
    const description =
      $('meta[name="description"]').attr("content")?.trim() ||
      $('meta[property="og:description"]').attr("content")?.trim() ||
      null;
    const generator = $('meta[name="generator"]').attr("content")?.trim() || null;
    const hasViewport = Boolean($('meta[name="viewport"]').attr("content"));
    const h1 = $("h1")
      .toArray()
      .map((node) => $(node).text().replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 8);
    const copyright =
      $("body")
        .text()
        .match(/©\s*\d{4}[^.\n]{0,60}/)?.[0]
        ?.trim() ?? null;
    const haystack = `${html}\n${generator ?? ""}`.toLowerCase();
    const techHints = Array.from(
      new Set(
        TECH_HINTS.filter((item) => haystack.includes(item.needle.toLowerCase())).map(
          (item) => item.label,
        ),
      ),
    );
    if (generator) techHints.unshift(generator);
    const linkedinUrls = extractLinkedInUrlsFromHtml(html).map((item) => item.url);

    return {
      requestedUrl: url,
      finalUrl: response.url,
      statusCode: response.status,
      title,
      description,
      h1,
      generator,
      hasViewport,
      techHints: Array.from(new Set(techHints)),
      copyright,
      error: response.ok ? null : `HTTP ${response.status}`,
      fetchedAt: new Date().toISOString(),
      linkedinUrls,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Website fetch timed out"
        : error instanceof Error
          ? error.message
          : "Website fetch failed";
    return emptySnapshot(url, message);
  } finally {
    clearTimeout(timer);
  }
}

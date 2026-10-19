import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseFirecrawlSearchPayload } from "./providers/firecrawl-parse";
import {
  actorAllowedInFullScrape,
  shouldFallbackToConnectedScrapers,
  shouldRetryActorAttempt,
  shouldRetryScrapeError,
} from "./pipeline-policy";

describe("full scrape pipeline policy", () => {
  it("runs Maps and keyword actors, skips LinkedIn, Fiverr, Instagram, and X", () => {
    assert.equal(
      actorAllowedInFullScrape({ actorId: "x/maps", displayName: "Google Maps Business Lead + Website Scraper" }),
      true,
    );
    assert.equal(actorAllowedInFullScrape({ actorId: "x/li", displayName: "LinkedIn people scraper" }), false);
    assert.equal(actorAllowedInFullScrape({ actorId: "x/fv", displayName: "Fiverr gigs", platform: "fiverr" }), false);
    assert.equal(
      actorAllowedInFullScrape({ actorId: "apidojo/tweet-scraper", displayName: "X / Twitter intent search (Acme Studio)" }),
      false,
    );
  });

  it("retries network failures but not Apify quota", () => {
    assert.equal(shouldRetryScrapeError("fetch failed"), true);
    assert.equal(shouldRetryScrapeError("Monthly usage hard limit exceeded"), false);
  });

  it("does not retry a succeeded Actor run, even when Apify attached a status message", () => {
    const finished = "Scraping finished. You can view all scraped places in the dataset.";
    assert.equal(shouldRetryActorAttempt({ status: "SUCCEEDED", error: finished }), false);
    assert.equal(shouldRetryActorAttempt({ status: "SUCCEEDED", error: null }), false);
    assert.equal(shouldRetryActorAttempt({ status: "FAILED", error: "fetch failed" }), true);
    assert.equal(shouldRetryActorAttempt({ status: "FAILED", error: "Monthly usage hard limit exceeded" }), false);
    assert.equal(shouldRetryActorAttempt({ status: "RUNNING", error: null }), false);
  });

  it("falls back to connected scrapers when Apify quota hits or Maps return nothing", () => {
    assert.equal(shouldFallbackToConnectedScrapers({ apifyQuotaHit: true, apifyLeadsCreated: 12 }), true);
    assert.equal(shouldFallbackToConnectedScrapers({ apifyQuotaHit: false, apifyLeadsCreated: 0 }), true);
    assert.equal(shouldFallbackToConnectedScrapers({ apifyQuotaHit: false, apifyLeadsCreated: 4 }), false);
  });

  it("reads Firecrawl v2 search rows from data.web", () => {
    const rows = parseFirecrawlSearchPayload({
      data: { web: [{ url: "https://example.com", title: "Example" }] },
    });
    assert.equal(rows.length, 1);
    assert.equal((rows[0] as { url: string }).url, "https://example.com");
  });
});

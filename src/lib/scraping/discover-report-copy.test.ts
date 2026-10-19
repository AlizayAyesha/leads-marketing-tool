import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDiscoverDoneBanner, formatDiscoverOperatorMessage, formatDiscoverSummary } from "./discover-report-types";

describe("discover report copy", () => {
  it("separates discovery from classification counters", () => {
    const text = formatDiscoverSummary({
      discovery: { new: 0, duplicates: 28, failed: 1, skipped: 4 },
      classification: {
        classified: 40,
        newThisRunEvaluated: 0,
        existingUnclassifiedEvaluated: 40,
        priority: 8,
        nurture: 17,
        rejected: 15,
      },
    });
    assert.match(text, /Discovery: 0 new · 28 duplicates · 4 skipped known URLs/);
    assert.match(text, /40 existing unclassified → 8 PRIORITY · 17 NURTURE · 15 REJECT/);
  });

  it("names listing-portal skips separately from known company URLs", () => {
    const text = formatDiscoverSummary({
      discovery: { new: 3, duplicates: 2, failed: 0, skipped: 1, skippedPortals: 8 },
      classification: {
        classified: 3,
        newThisRunEvaluated: 3,
        existingUnclassifiedEvaluated: 0,
        priority: 0,
        nurture: 0,
        rejected: 3,
      },
    });
    assert.match(text, /1 skipped known URL · 8 skipped listing portals/);
  });

  it("does not fail Discover when Sheets credentials are expired", () => {
    const message = formatDiscoverOperatorMessage({
      summary: "Discovery: 28 new · 0 duplicates · 0 skipped known URLs. 28 new this run → 0 PRIORITY · 0 NURTURE · 28 REJECT.",
      sheetOk: false,
      sheetMessage: "Google Sheets credentials are invalid or expired. Reconnect Google in Settings.",
      quota: true,
      discoveryNew: 28,
    });
    assert.match(message, /Leads stay in Postgres/);
    assert.match(message, /do not Discover again just to retry the sheet/);
    assert.doesNotMatch(message, /Fix Sheets, then discover again/);
  });

  it("shows legitimate zero-work when nothing new and nothing to classify", () => {
    const banner = formatDiscoverDoneBanner({
      discovery: { new: 0, duplicates: 0, failed: 0, skipped: 0 },
      classification: {
        classified: 0,
        newThisRunEvaluated: 0,
        existingUnclassifiedEvaluated: 0,
        priority: 0,
        nurture: 0,
        rejected: 0,
      },
    });
    assert.equal(banner, "Done — 0 new · 0 classified · 0 PRIORITY");
  });
});

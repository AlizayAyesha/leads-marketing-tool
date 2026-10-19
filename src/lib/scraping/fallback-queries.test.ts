import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_BUSINESS_POLICY } from "@/lib/config/business";
import { defaultCampaignBrief } from "@/lib/campaigns/intent";
import { rotatedFallbackQueries } from "./fallback-queries";

describe("rotated fallback queries", () => {
  it("changes geo and ecosystem terminology across cursor ticks", () => {
    const policy = {
      ...DEFAULT_BUSINESS_POLICY,
      icp: {
        ...DEFAULT_BUSINESS_POLICY.icp,
        geographies: ["Dubai", "Riyadh"],
        industries: [],
      },
    };
    const brief = { cities: ["Dubai", "Riyadh"], regions: ["UAE", "Saudi Arabia"] };
    const first = rotatedFallbackQueries(policy, 0, brief);
    const second = rotatedFallbackQueries(policy, 6, brief);
    assert.notDeepEqual(first, second);
    assert.ok(first.every((query) => query.includes("Dubai") || query.includes("Riyadh")));
    assert.equal(first.length, 6);
  });

  it("uses policy industries when configured", () => {
    const policy = {
      ...DEFAULT_BUSINESS_POLICY,
      icp: {
        ...DEFAULT_BUSINESS_POLICY.icp,
        geographies: ["London"],
        industries: ["Private Aviation"],
      },
    };
    const queries = rotatedFallbackQueries(policy, 0, { cities: ["London"] });
    assert.ok(queries.some((query) => query.toLowerCase().includes("london")));
  });

  it("seeds priority and elite cities from default brief", () => {
    const policy = {
      ...DEFAULT_BUSINESS_POLICY,
      icp: {
        ...DEFAULT_BUSINESS_POLICY.icp,
        geographies: [],
        industries: [],
      },
    };
    const queries = rotatedFallbackQueries(policy, 0, defaultCampaignBrief());
    const blob = queries.join(" ").toLowerCase();
    assert.ok(
      /karachi|ibiza|mykonos|dubai|são paulo|sao paulo|goiânia|goiania/.test(blob),
      `expected priority/elite city in queries, got: ${queries.slice(0, 3).join(" | ")}`,
    );
    const rotated = Array.from({ length: 12 }, (_, tick) =>
      rotatedFallbackQueries(policy, tick * 6, defaultCampaignBrief()).join(" "),
    ).join(" ");
    assert.ok(/luxury villa developer/i.test(rotated));
    assert.ok(!/\bvilla sales\b/i.test(rotated));
  });

  it("defaults to local operators — not private equity directories", () => {
    const policy = {
      ...DEFAULT_BUSINESS_POLICY,
      icp: {
        ...DEFAULT_BUSINESS_POLICY.icp,
        geographies: [],
        industries: [],
      },
    };
    const rotated = Array.from({ length: 20 }, (_, tick) =>
      rotatedFallbackQueries(policy, tick * 6, defaultCampaignBrief()).join(" "),
    ).join(" | ");
    assert.ok(/restaurant owner|dental clinic|private clinic|hotel owner/i.test(rotated));
    assert.ok(!/private equity/i.test(rotated));
    assert.ok(!/asset management/i.test(rotated));
    assert.ok(!/family office/i.test(rotated));
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditLead } from "@/lib/intelligence/audit";
import { DEFAULT_BUSINESS_POLICY } from "@/lib/config/business";
import { buildPdlDiscoverySql } from "@/lib/discovery/query";
import { chooseWebsiteLinkedInUrl, extractLinkedInUrlsFromHtml } from "@/lib/enrichment/website-linkedin";
import { canIdentifyLead, decideLinkedInIdentifyWrite } from "@/lib/enrichment/identify-policy";
import { PdlLinkedInProvider } from "@/lib/linkedin/pdl-provider";
import { queryLinkedInResearch } from "@/lib/linkedin/query";
import { shouldUsePdlLinkedInProvider } from "@/lib/linkedin/registry";
import { canSendMessage } from "@/lib/outreach/gate";
import { DEFAULT_OUTREACH_ENGINE } from "@/lib/outreach/policy";
import { HARD_PDL_DISCOVER_DAILY_CAP, HARD_PDL_LOOKUP_DAILY_CAP, PDL_ADAPTER_ID } from "@/lib/pdl/constants";
import { pdlPersonToResearchResult } from "@/lib/pdl/map-person";
import { pdlDailyQuota } from "@/lib/pdl/quota";
import type { PdlPerson } from "@/lib/pdl/types";

const PROFILE = "https://www.linkedin.com/in/seanthorne";

const PERSON: PdlPerson = {
  id: "pdl_1",
  full_name: "Sean Thorne",
  job_title: "Founder and CEO",
  job_title_role: "founder",
  job_title_levels: ["cxo", "owner"],
  job_company_name: "People Data Labs",
  industry: "computer software",
  location_name: "San Francisco, California, United States",
  linkedin_url: "linkedin.com/in/seanthorne",
  linkedin_connections: 500,
  inferred_years_experience: 12,
  summary: "Builds licensed people data APIs.",
  experience: [
    { title: { name: "Founder and CEO" }, company: { name: "People Data Labs" } },
    { title: { name: "Engineer" }, company: { name: "Earlier Co" } },
  ],
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PDL person mapping", () => {
  it("maps a licensed person record into LinkedIn evidence without inventing a buying need", () => {
    const result = pdlPersonToResearchResult({ person: PERSON, requestedUrl: PROFILE, likelihood: 9 });
    assert.equal(result.status, "AVAILABLE");
    assert.equal(result.adapter, PDL_ADAPTER_ID);
    assert.equal(result.profile?.roleTitle, "Founder and CEO");
    assert.equal(result.profile?.currentCompany, "People Data Labs");
    assert.equal(result.profile?.profileUrl, "https://www.linkedin.com/in/seanthorne");
    assert.ok(result.evidence.some((item) => item.category === "role_title"));
    assert.ok(!result.evidence.some((item) => /needs a website/i.test(item.value)));
  });

  it("lets Decision Maker treat mapped seniority as established", () => {
    const mapped = pdlPersonToResearchResult({ person: PERSON, requestedUrl: PROFILE, likelihood: 9 });
    const result = auditLead({
      name: "Sean Thorne",
      company: "People Data Labs",
      website: "https://peopledatalabs.com",
      websiteHost: "peopledatalabs.com",
      email: "sean@peopledatalabs.com",
      linkedinUrl: PROFILE,
      linkedinResearch: {
        status: mapped.status,
        headline: mapped.profile?.headline,
        about: mapped.profile?.about,
        roleTitle: mapped.profile?.roleTitle,
        currentCompany: mapped.profile?.currentCompany,
        publicSignals: mapped.profile?.publicSignals,
      },
    });
    assert.equal(result.linkedin.seniority, "established");
    assert.ok(result.allowedChannels.includes("LINKEDIN"));
  });
});

describe("PDL LinkedIn provider HTTP mapping", () => {
  it("returns AVAILABLE evidence from a 200 enrich match and never puts the API key in the URL", async () => {
    const seen: string[] = [];
    const provider = new PdlLinkedInProvider({
      getApiKey: async () => "secret-key",
      fetchImpl: async (input) => {
        seen.push(String(input));
        return jsonResponse(200, { status: 200, likelihood: 9, data: PERSON });
      },
    });
    const result = await queryLinkedInResearch({ profileUrl: PROFILE, provider });
    assert.equal(result.status, "AVAILABLE");
    assert.equal(result.profile?.displayName, "Sean Thorne");
    assert.ok(seen[0]?.includes("profile="));
    assert.ok(!seen[0]?.includes("secret-key"));
    assert.ok(!seen[0]?.includes("api_key"));
  });

  it("maps 404 to UNAVAILABLE, 401 to AUTH_REQUIRED, 429 to RATE_LIMITED", async () => {
    const notFound = await queryLinkedInResearch({
      profileUrl: PROFILE,
      provider: new PdlLinkedInProvider({
        getApiKey: async () => "k",
        fetchImpl: async () => jsonResponse(404, { status: 404 }),
      }),
    });
    assert.equal(notFound.status, "UNAVAILABLE");
    assert.equal(notFound.code, "PDL_NOT_FOUND");

    const auth = await queryLinkedInResearch({
      profileUrl: PROFILE,
      provider: new PdlLinkedInProvider({
        getApiKey: async () => "k",
        fetchImpl: async () => jsonResponse(401, { status: 401 }),
      }),
    });
    assert.equal(auth.status, "AUTH_REQUIRED");

    const limited = await queryLinkedInResearch({
      profileUrl: PROFILE,
      provider: new PdlLinkedInProvider({
        getApiKey: async () => "k",
        fetchImpl: async () => jsonResponse(429, { status: 429 }),
      }),
    });
    assert.equal(limited.status, "RATE_LIMITED");
  });

  it("does not call PDL when the key is missing", async () => {
    let called = false;
    const result = await queryLinkedInResearch({
      profileUrl: PROFILE,
      provider: new PdlLinkedInProvider({
        getApiKey: async () => null,
        fetchImpl: async () => {
          called = true;
          return jsonResponse(200, { status: 200, data: PERSON });
        },
      }),
    });
    assert.equal(called, false);
    assert.equal(result.status, "AUTH_REQUIRED");
    assert.equal(result.code, "PDL_API_KEY_MISSING");
  });
});

describe("website LinkedIn extraction", () => {
  it("stores a single public person URL and will not guess among many", () => {
    const html = `
      <a href="https://www.linkedin.com/in/ada-khan">Ada</a>
      <p>https://linkedin.com/company/khan-clinics</p>
    `;
    const extracted = extractLinkedInUrlsFromHtml(html);
    assert.ok(extracted.some((item) => item.kind === "person"));
    const chosen = chooseWebsiteLinkedInUrl({
      extracted,
      leadName: "Ada Khan",
      existingUrl: null,
    });
    assert.equal(chosen?.url, "https://www.linkedin.com/in/ada-khan");

    const many = chooseWebsiteLinkedInUrl({
      extracted: [
        { url: "https://www.linkedin.com/in/one", kind: "person" },
        { url: "https://www.linkedin.com/in/two", kind: "person" },
      ],
      leadName: "Someone Else",
      existingUrl: null,
    });
    assert.equal(many, null);
  });

  it("does not overwrite an existing person LinkedIn URL", () => {
    const chosen = chooseWebsiteLinkedInUrl({
      extracted: [{ url: "https://www.linkedin.com/in/new-person", kind: "person" }],
      leadName: "Ada Khan",
      existingUrl: "https://www.linkedin.com/in/ada-khan",
    });
    assert.equal(chosen, null);
  });
});

describe("PDL identify write policy", () => {
  it("writes only a high-likelihood person URL and never overwrites an existing person URL", () => {
    const write = decideLinkedInIdentifyWrite({
      existingLinkedInUrl: null,
      httpStatus: 200,
      likelihood: 8,
      linkedinUrl: "linkedin.com/in/ada-khan",
    });
    assert.equal(write.write, true);
    if (write.write) assert.equal(write.url, "https://www.linkedin.com/in/ada-khan");

    const skipExisting = decideLinkedInIdentifyWrite({
      existingLinkedInUrl: "https://www.linkedin.com/in/ada-khan",
      httpStatus: 200,
      likelihood: 9,
      linkedinUrl: "linkedin.com/in/other",
    });
    assert.equal(skipExisting.write, false);

    const weak = decideLinkedInIdentifyWrite({
      existingLinkedInUrl: null,
      httpStatus: 200,
      likelihood: 3,
      linkedinUrl: "linkedin.com/in/maybe",
    });
    assert.equal(weak.write, false);

    const missing = decideLinkedInIdentifyWrite({
      existingLinkedInUrl: null,
      httpStatus: 404,
      likelihood: 9,
      linkedinUrl: null,
    });
    assert.equal(missing.write, false);
  });

  it("requires enough identity to call PDL", () => {
    assert.equal(canIdentifyLead({ name: "Ada Khan", company: "Khan Clinics" }), true);
    assert.equal(canIdentifyLead({ email: "ada@khanclinics.com" }), true);
    assert.equal(canIdentifyLead({ name: "Ada" }), false);
  });
});

describe("PDL discovery query and caps", () => {
  it("builds a licensed person-search SQL and rejects unsafe tokens", () => {
    const sql = buildPdlDiscoverySql({
      ...DEFAULT_BUSINESS_POLICY.icp,
      jobTitles: ["founder", "owner"],
      industries: ["computer software"],
      geographies: ["US"],
    });
    assert.match(sql, /linkedin_url IS NOT NULL/);
    assert.match(sql, /job_title_role IN \('founder', 'owner'\)/);
    assert.match(sql, /location_country IN \('united states'\)/);
    assert.doesNotMatch(sql, /drop table/i);

    const mixed = buildPdlDiscoverySql({
      ...DEFAULT_BUSINESS_POLICY.icp,
      jobTitles: ["founder", "ceo", "head of marketing"],
      industries: [],
      geographies: [],
    });
    assert.match(mixed, /job_title LIKE '%ceo%'/);
    assert.match(mixed, /job_title LIKE '%head of marketing%'/);
    assert.match(mixed, / OR /);
    assert.doesNotMatch(mixed, /job_title_role IN \('founder'\) AND job_title LIKE '%ceo%'/);

    const injected = buildPdlDiscoverySql({
      ...DEFAULT_BUSINESS_POLICY.icp,
      industries: ["software'; DROP TABLE person; --"],
      geographies: ["US"],
    });
    assert.doesNotMatch(injected, /DROP TABLE/i);
  });

  it("treats discover and lookup daily caps as hard ceilings", () => {
    assert.equal(HARD_PDL_DISCOVER_DAILY_CAP, 100);
    assert.equal(HARD_PDL_LOOKUP_DAILY_CAP, 100);
    const quota = pdlDailyQuota({
      lookupsToday: HARD_PDL_LOOKUP_DAILY_CAP,
      discoveriesToday: HARD_PDL_DISCOVER_DAILY_CAP,
      lookupCap: 999,
      discoverCap: 999,
    });
    assert.equal(quota.lookupCap, HARD_PDL_LOOKUP_DAILY_CAP);
    assert.equal(quota.discoverCap, HARD_PDL_DISCOVER_DAILY_CAP);
    assert.equal(quota.lookupsRemaining, 0);
    assert.equal(quota.discoveriesRemaining, 0);
  });
});

describe("PDL registry selection", () => {
  it("uses PDL when a key is present or the provider is explicitly pdl", () => {
    assert.equal(shouldUsePdlLinkedInProvider("", true), true);
    assert.equal(shouldUsePdlLinkedInProvider("pdl", false), true);
    assert.equal(shouldUsePdlLinkedInProvider("none", true), false);
    assert.equal(shouldUsePdlLinkedInProvider("", false), false);
    assert.equal(shouldUsePdlLinkedInProvider("agent-reach", true), false);
  });
});

describe("PDL path does not become a send adapter", () => {
  it("still blocks LinkedIn message send", () => {
    assert.equal(
      canSendMessage({
        policy: { ...DEFAULT_OUTREACH_ENGINE, sendMode: "send_on_approve", sendsPaused: false },
        sentToday: 0,
        activeSequences: 0,
        auditVerdict: "PASS",
        auditedAt: new Date().toISOString(),
        leadStatus: "QUALIFIED",
        suppressed: false,
        unsubscribed: false,
        draftStatus: "APPROVED",
        channel: "LINKEDIN",
        gmailSendConnected: true,
        sequenceStatus: "ACTIVE",
      }).code,
      "SOCIAL_SEND_BLOCKED",
    );
  });
});

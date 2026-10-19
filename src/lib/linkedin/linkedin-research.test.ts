import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditLead } from "@/lib/intelligence/audit";
import { buildLeadSignalsContract } from "@/lib/intelligence/structured-signals";
import { assertSignalEvidence } from "@/lib/contracts/signals";
import { DEFAULT_OUTREACH_ENGINE, HARD_DAILY_SEND_LIMIT, HARD_MAX_ACTIVE_SEQUENCES } from "@/lib/outreach/policy";
import { shouldReuseLinkedInResearch } from "@/lib/linkedin/cache";
import { evidenceFromProfile, isForbiddenNeedInference, sanitizeLinkedInResearchResult } from "@/lib/linkedin/evidence";
import { LinkedInResearchError } from "@/lib/linkedin/provider";
import { queryLinkedInResearch } from "@/lib/linkedin/query";
import type { LinkedInResearchProvider } from "@/lib/linkedin/provider";
import type { LinkedInResearchResult } from "@/lib/linkedin/types";
import { LINKEDIN_RESEARCH_UNAVAILABLE } from "@/lib/linkedin/types";
import { UnavailableLinkedInProvider } from "@/lib/linkedin/unavailable-provider";
import { inspectLinkedInUrl, normalizeLinkedInProfileUrl } from "@/lib/linkedin/url";

const PROFILE = "https://www.linkedin.com/in/sam-tester-example/";
const TRACE_ID = "trace-linkedin-test";

class StubProvider implements LinkedInResearchProvider {
  readonly id = "stub";
  readonly version = "test";
  constructor(
    readonly configured: boolean,
    private readonly impl: () => Promise<LinkedInResearchResult> | LinkedInResearchResult,
  ) {}
  async fetchProfile() {
    return this.impl();
  }
}

function availableResult(overrides: Partial<LinkedInResearchResult> = {}): LinkedInResearchResult {
  const retrievedAt = new Date().toISOString();
  const profile = {
    profileUrl: PROFILE,
    displayName: "Sam Tester",
    headline: "Founder at Example Studio",
    currentCompany: "Example Studio",
    roleTitle: "Founder",
    location: "Karachi",
    industry: "Media",
    about: "Editor and founder.",
    companyAssociation: "Example Studio",
    publicSignals: { experiences: [{ title: "Founder" }, { title: "Editor" }], connections: 400 },
  };
  return {
    status: "AVAILABLE",
    code: "OK",
    profile,
    evidence: evidenceFromProfile(profile, retrievedAt),
    sourceUrl: PROFILE,
    retrievedAt,
    adapter: "stub",
    adapterVersion: "test",
    ...overrides,
  };
}

describe("LinkedIn URL normalization", () => {
  it("normalizes valid person URLs", () => {
    assert.equal(
      normalizeLinkedInProfileUrl("https://linkedin.com/in/sam-tester-example?trk=public"),
      "https://www.linkedin.com/in/sam-tester-example",
    );
    assert.equal(inspectLinkedInUrl(PROFILE).kind, "person");
  });

  it("rejects invalid LinkedIn URLs", () => {
    assert.equal(inspectLinkedInUrl("https://example.com/in/ada").kind, "wrong_host");
    assert.equal(inspectLinkedInUrl("https://www.linkedin.com/search/results/people/?keywords=acme").kind, "not_profile");
    assert.equal(inspectLinkedInUrl("not a url").kind, "invalid");
    assert.equal(inspectLinkedInUrl("").kind, "missing");
    assert.equal(normalizeLinkedInProfileUrl("https://www.linkedin.com/feed/"), null);
  });
});

describe("LinkedIn research query statuses", () => {
  it("returns UNAVAILABLE when no authorized provider is configured", async () => {
    const result = await queryLinkedInResearch({
      profileUrl: PROFILE,
      provider: new UnavailableLinkedInProvider(),
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.code, LINKEDIN_RESEARCH_UNAVAILABLE);
    assert.equal(result.evidence.length, 0);
    assert.equal(result.profile, null);
  });

  it("returns research success with evidence and source URL", async () => {
    const result = await queryLinkedInResearch({
      profileUrl: PROFILE,
      provider: new StubProvider(true, () => availableResult()),
    });
    assert.equal(result.status, "AVAILABLE");
    assert.ok(result.evidence.length > 0);
    assert.equal(result.sourceUrl, PROFILE);
    assert.ok(result.evidence.every((item) => item.sourceUrl && item.timestamp && item.evidence));
    const withTrace = { ...result, traceId: TRACE_ID };
    assert.equal(withTrace.traceId, TRACE_ID);
  });

  it("maps timeout, auth required, and rate limit", async () => {
    const timeout = await queryLinkedInResearch({
      profileUrl: PROFILE,
      provider: new StubProvider(true, () => {
        const error = new Error("LinkedIn research timed out");
        error.name = "AbortError";
        throw error;
      }),
    });
    assert.equal(timeout.status, "TIMEOUT");

    const auth = await queryLinkedInResearch({
      profileUrl: PROFILE,
      provider: new StubProvider(true, () => {
        throw new LinkedInResearchError("AUTH_REQUIRED", "AUTH_REQUIRED", "401 unauthorized");
      }),
    });
    assert.equal(auth.status, "AUTH_REQUIRED");

    const limited = await queryLinkedInResearch({
      profileUrl: PROFILE,
      provider: new StubProvider(true, () => {
        throw new LinkedInResearchError("RATE_LIMITED", "RATE_LIMITED", "429 rate limit");
      }),
    });
    assert.equal(limited.status, "RATE_LIMITED");
  });

  it("does not turn a malformed response into fake evidence", async () => {
    const result = await queryLinkedInResearch({
      profileUrl: PROFILE,
      provider: new StubProvider(true, () => ({ garbage: true }) as unknown as LinkedInResearchResult),
    });
    assert.equal(result.status, "ERROR");
    assert.equal(result.evidence.length, 0);
    assert.equal(result.profile, null);
  });

  it("rejects invalid URLs without calling a successful fetch as AVAILABLE", async () => {
    const result = await queryLinkedInResearch({
      profileUrl: "https://www.linkedin.com/search/results/people/",
      provider: new StubProvider(true, () => availableResult()),
    });
    assert.equal(result.status, "ERROR");
    assert.equal(result.code, "INVALID_LINKEDIN_URL");
    assert.equal(result.evidence.length, 0);
  });
});

describe("LinkedIn evidence contract", () => {
  it("preserves observed evidence and drops title-to-need inferences", () => {
    const retrievedAt = new Date().toISOString();
    const items = evidenceFromProfile(
      {
        profileUrl: PROFILE,
        displayName: "Ada",
        headline: "Founder needs a website",
        currentCompany: "Ada Labs",
        roleTitle: "Founder",
        location: null,
        industry: null,
        about: "Needs AI and SEO",
        companyAssociation: "Ada Labs",
        publicSignals: {},
      },
      retrievedAt,
    );
    assert.ok(items.some((item) => item.category === "role_title" && item.value === "Founder"));
    assert.ok(!items.some((item) => /needs a website/i.test(item.value)));
    assert.ok(!items.some((item) => /needs ai/i.test(item.value)));
    assert.equal(isForbiddenNeedInference("needs automation"), true);
  });

  it("rejects present signals with no evidence", () => {
    const item = assertSignalEvidence({
      id: "linkedin-headline",
      kind: "role",
      label: "LinkedIn headline",
      present: true,
      evidence: "",
      sourceUrl: PROFILE,
    });
    assert.equal(item.present, false);
    assert.equal(item.rejected, true);
  });
});

describe("LinkedIn research caching", () => {
  it("reuses a fresh cached profile URL and honors forced refresh", () => {
    const retrievedAt = new Date();
    assert.equal(
      shouldReuseLinkedInResearch({
        retrievedAt,
        normalizedUrl: "https://www.linkedin.com/in/sam-tester-example",
        requestedNormalizedUrl: "https://www.linkedin.com/in/sam-tester-example",
      }),
      true,
    );
    assert.equal(
      shouldReuseLinkedInResearch({
        forceRefresh: true,
        retrievedAt,
        normalizedUrl: "https://www.linkedin.com/in/sam-tester-example",
        requestedNormalizedUrl: "https://www.linkedin.com/in/sam-tester-example",
      }),
      false,
    );
    assert.equal(
      shouldReuseLinkedInResearch({
        retrievedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        normalizedUrl: "https://www.linkedin.com/in/sam-tester-example",
        requestedNormalizedUrl: "https://www.linkedin.com/in/sam-tester-example",
      }),
      false,
    );
  });
});

describe("Signal Agent LinkedIn evidence", () => {
  it("turns stored LinkedIn evidence into signals without inventing a buying need from a title", () => {
    const retrievedAt = new Date().toISOString();
    const contract = buildLeadSignalsContract({
      leadId: "ZJ-TEST",
      name: "Sam Tester",
      linkedinUrl: PROFILE,
      linkedinResearch: {
        status: "AVAILABLE",
        roleTitle: "Founder",
        headline: "Founder at Example Studio",
        currentCompany: "Example Studio",
        sourceUrl: PROFILE,
        evidenceItems: evidenceFromProfile(
          {
            profileUrl: PROFILE,
            displayName: "Sam Tester",
            headline: "Founder at Example Studio",
            currentCompany: "Example Studio",
            roleTitle: "Founder",
            location: null,
            industry: null,
            about: null,
            companyAssociation: "Example Studio",
            publicSignals: {},
          },
          retrievedAt,
        ),
      },
    });
    assert.ok(contract.items.some((item) => item.id === "linkedin-role_title" && item.present));
    assert.ok(!contract.items.some((item) => item.kind === "buying" && item.present));
    assert.ok(!contract.legacy.mentions_website_need);
  });
});

describe("Decision Maker LinkedIn research consumption", () => {
  it("uses stored LinkedIn evidence for seniority", () => {
    const result = auditLead({
      name: "Ada Khan",
      company: "Khan Clinics",
      website: "https://khanclinics.com",
      websiteHost: "khanclinics.com",
      email: "ada@khanclinics.com",
      linkedinUrl: "https://www.linkedin.com/in/ada-khan",
      linkedinResearch: {
        status: "AVAILABLE",
        headline: "Founder & Clinic Director",
        publicSignals: { experiences: [{ title: "Founder" }, { title: "Director" }], connections: 800 },
      },
    });
    assert.equal(result.linkedin.seniority, "established");
    assert.ok(result.allowedChannels.includes("LINKEDIN"));
  });

  it("does not PASS because a LinkedIn research row exists without evidence", () => {
    const result = auditLead({
      name: "Jordan Lee",
      company: "Lee Studio",
      website: "https://leestudio.co",
      email: "jordan@leestudio.co",
      linkedinUrl: "https://linkedin.com/in/jordanlee",
      linkedinResearch: { status: "AVAILABLE", headline: null, publicSignals: {} },
    });
    assert.notEqual(result.verdict, "PASS");
    assert.equal(result.linkedin.status, "UNKNOWN");
  });

  it("cannot create PASS from a research failure", () => {
    const result = auditLead({
      name: "Jordan Lee",
      company: "Lee Studio",
      website: "https://leestudio.co",
      websiteHost: "leestudio.co",
      email: "jordan@leestudio.co",
      linkedinUrl: "https://linkedin.com/in/jordanlee",
      linkedinResearch: { status: "TIMEOUT" },
      rawPayload: {
        headline: "Founder & Studio Director",
        experiences: [{ title: "Founder" }, { title: "Director" }],
        connections: 900,
      },
    });
    assert.notEqual(result.verdict, "PASS");
    assert.equal(result.linkedin.seniority, "unknown");
    assert.ok(result.unknowns.some((item) => /TIMEOUT/i.test(item)));
  });
});

describe("production safety remains unchanged", () => {
  it("keeps kill switch, draft_only, and caps", () => {
    assert.equal(DEFAULT_OUTREACH_ENGINE.sendsPaused, true);
    assert.equal(DEFAULT_OUTREACH_ENGINE.sendMode, "draft_only");
    assert.ok(DEFAULT_OUTREACH_ENGINE.dailySendLimit <= HARD_DAILY_SEND_LIMIT);
    assert.equal(DEFAULT_OUTREACH_ENGINE.maxActiveSequences, HARD_MAX_ACTIVE_SEQUENCES);
    assert.equal(HARD_DAILY_SEND_LIMIT, 100);
    assert.equal(HARD_MAX_ACTIVE_SEQUENCES, 250);
  });
});

describe("sanitize malformed available payloads", () => {
  it("drops forbidden need claims even if a provider sends them", () => {
    const sanitized = sanitizeLinkedInResearchResult(
      {
        status: "AVAILABLE",
        code: "OK",
        sourceUrl: PROFILE,
        profile: {
          profileUrl: PROFILE,
          displayName: "Ada",
          headline: "Founder",
          currentCompany: null,
          roleTitle: "Founder",
          location: null,
          industry: null,
          about: null,
          companyAssociation: null,
          publicSignals: {},
        },
        evidence: [
          {
            category: "headline",
            value: "needs a website",
            evidence: "needs a website",
            sourceUrl: PROFILE,
            timestamp: new Date().toISOString(),
            confidence: "observed",
          },
        ],
      },
      PROFILE,
    );
    assert.equal(sanitized.status, "AVAILABLE");
    assert.ok(!sanitized.evidence.some((item) => /needs a website/i.test(item.value)));
  });
});

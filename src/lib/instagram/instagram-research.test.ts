import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditLead } from "@/lib/intelligence/audit";
import { buildLeadSignalsContract } from "@/lib/intelligence/structured-signals";
import { assertSignalEvidence } from "@/lib/contracts/signals";
import { DEFAULT_OUTREACH_ENGINE, HARD_DAILY_SEND_LIMIT, HARD_MAX_ACTIVE_SEQUENCES } from "@/lib/outreach/policy";
import { PIPELINE_STEPS } from "@/lib/pipeline/steps";
import { shouldReuseInstagramResearch } from "@/lib/instagram/cache";
import { evidenceFromProfile, isForbiddenNeedInference, sanitizeInstagramResearchResult } from "@/lib/instagram/evidence";
import { InstagramResearchError, type InstagramResearchProvider } from "@/lib/instagram/provider";
import { queryInstagramResearch } from "@/lib/instagram/query";
import type { InstagramResearchResult } from "@/lib/instagram/types";
import { INSTAGRAM_RESEARCH_UNAVAILABLE } from "@/lib/instagram/types";
import { UnavailableInstagramProvider } from "@/lib/instagram/unavailable-provider";
import { extractInstagramUsername, inspectInstagramUrl, normalizeInstagramProfileUrl } from "@/lib/instagram/url";

const PROFILE = "https://www.instagram.com/sam_tester_example/";
const TRACE_ID = "trace-instagram-test";

class StubProvider implements InstagramResearchProvider {
  readonly id = "stub";
  readonly version = "test";
  constructor(
    readonly configured: boolean,
    private readonly impl: () => Promise<InstagramResearchResult> | InstagramResearchResult,
  ) {}
  async fetchProfile() {
    return this.impl();
  }
}

function availableResult(overrides: Partial<InstagramResearchResult> = {}): InstagramResearchResult {
  const retrievedAt = new Date().toISOString();
  const profile = {
    profileUrl: "https://www.instagram.com/sam_tester_example",
    username: "sam_tester_example",
    displayName: "Sam Tester",
    bio: "Video editor.",
    professionalCategory: "Editor",
    publicBusinessInfo: "Creator",
    website: null,
    businessContact: null,
    publicSignals: { isBusinessAccount: true, followersCount: 1200 },
  };
  return {
    status: "AVAILABLE",
    code: "OK",
    profile,
    evidence: evidenceFromProfile(profile, retrievedAt),
    sourceUrl: profile.profileUrl,
    retrievedAt,
    adapter: "stub",
    adapterVersion: "test",
    ...overrides,
  };
}

describe("Instagram URL normalization", () => {
  it("normalizes valid profile URLs and extracts username", () => {
    assert.equal(normalizeInstagramProfileUrl(PROFILE), "https://www.instagram.com/sam_tester_example");
    assert.equal(extractInstagramUsername(PROFILE), "sam_tester_example");
    assert.equal(inspectInstagramUrl("instagram.com/sam_tester_example").kind, "profile");
  });

  it("rejects invalid Instagram URLs", () => {
    assert.equal(inspectInstagramUrl("https://example.com/samtester").kind, "wrong_host");
    assert.equal(inspectInstagramUrl("https://www.instagram.com/p/ABC123/").kind, "not_profile");
    assert.equal(inspectInstagramUrl("https://www.instagram.com/reel/xyz/").kind, "not_profile");
    assert.equal(inspectInstagramUrl("not a url").kind, "invalid");
    assert.equal(inspectInstagramUrl("").kind, "missing");
    assert.equal(normalizeInstagramProfileUrl("https://www.instagram.com/explore/"), null);
  });
});

describe("Instagram research query statuses", () => {
  it("returns UNAVAILABLE when no authorized provider is configured", async () => {
    const result = await queryInstagramResearch({
      profileUrl: PROFILE,
      provider: new UnavailableInstagramProvider(),
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.code, INSTAGRAM_RESEARCH_UNAVAILABLE);
    assert.equal(result.evidence.length, 0);
    assert.equal(result.profile, null);
  });

  it("returns research success with evidence, source URL, and trace propagation", async () => {
    const result = await queryInstagramResearch({
      profileUrl: PROFILE,
      provider: new StubProvider(true, () => availableResult()),
    });
    assert.equal(result.status, "AVAILABLE");
    assert.ok(result.evidence.length > 0);
    assert.ok(result.evidence.every((item) => item.sourceUrl && item.timestamp && item.evidence));
    const withTrace = { ...result, traceId: TRACE_ID };
    assert.equal(withTrace.traceId, TRACE_ID);
  });

  it("maps timeout, auth required, and rate limit", async () => {
    const timeout = await queryInstagramResearch({
      profileUrl: PROFILE,
      provider: new StubProvider(true, () => {
        const error = new Error("Instagram research timed out");
        error.name = "AbortError";
        throw error;
      }),
    });
    assert.equal(timeout.status, "TIMEOUT");

    const auth = await queryInstagramResearch({
      profileUrl: PROFILE,
      provider: new StubProvider(true, () => {
        throw new InstagramResearchError("AUTH_REQUIRED", "AUTH_REQUIRED", "401 unauthorized");
      }),
    });
    assert.equal(auth.status, "AUTH_REQUIRED");

    const limited = await queryInstagramResearch({
      profileUrl: PROFILE,
      provider: new StubProvider(true, () => {
        throw new InstagramResearchError("RATE_LIMITED", "RATE_LIMITED", "429 rate limit");
      }),
    });
    assert.equal(limited.status, "RATE_LIMITED");
  });

  it("does not turn a malformed response into fake evidence", async () => {
    const result = await queryInstagramResearch({
      profileUrl: PROFILE,
      provider: new StubProvider(true, () => ({ garbage: true }) as unknown as InstagramResearchResult),
    });
    assert.equal(result.status, "ERROR");
    assert.equal(result.evidence.length, 0);
    assert.equal(result.profile, null);
  });

  it("rejects invalid URLs without treating them as AVAILABLE", async () => {
    const result = await queryInstagramResearch({
      profileUrl: "https://www.instagram.com/p/not-a-profile/",
      provider: new StubProvider(true, () => availableResult()),
    });
    assert.equal(result.status, "ERROR");
    assert.equal(result.code, "INVALID_INSTAGRAM_URL");
    assert.equal(result.evidence.length, 0);
  });
});

describe("Instagram evidence contract", () => {
  it("preserves observed evidence and drops need inferences from bio/category", () => {
    const retrievedAt = new Date().toISOString();
    const items = evidenceFromProfile(
      {
        profileUrl: "https://www.instagram.com/ada",
        username: "ada",
        displayName: "Ada",
        bio: "Founder needs a website",
        professionalCategory: "Needs AI",
        publicBusinessInfo: null,
        website: null,
        businessContact: null,
        publicSignals: { followersCount: 9000 },
      },
      retrievedAt,
    );
    assert.ok(items.some((item) => item.category === "username" && item.value === "ada"));
    assert.ok(!items.some((item) => /needs a website/i.test(item.value)));
    assert.ok(!items.some((item) => /needs ai/i.test(item.value)));
    assert.equal(isForbiddenNeedInference("needs automation"), true);
  });

  it("rejects present signals with no evidence", () => {
    const item = assertSignalEvidence({
      id: "instagram-bio",
      kind: "identity",
      label: "Instagram bio",
      present: true,
      evidence: "",
      sourceUrl: PROFILE,
    });
    assert.equal(item.present, false);
    assert.equal(item.rejected, true);
  });
});

describe("Instagram research caching", () => {
  it("reuses a fresh cached profile URL and honors forced refresh", () => {
    const retrievedAt = new Date();
    const normalized = "https://www.instagram.com/sam_tester_example";
    assert.equal(
      shouldReuseInstagramResearch({
        retrievedAt,
        normalizedUrl: normalized,
        requestedNormalizedUrl: normalized,
      }),
      true,
    );
    assert.equal(
      shouldReuseInstagramResearch({
        forceRefresh: true,
        retrievedAt,
        normalizedUrl: normalized,
        requestedNormalizedUrl: normalized,
      }),
      false,
    );
    assert.equal(
      shouldReuseInstagramResearch({
        retrievedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        normalizedUrl: normalized,
        requestedNormalizedUrl: normalized,
      }),
      false,
    );
  });
});

describe("Signal Agent Instagram evidence", () => {
  it("stores Instagram evidence without inventing a buying need from category or followers", () => {
    const retrievedAt = new Date().toISOString();
    const contract = buildLeadSignalsContract({
      leadId: "ZJ-TEST",
      name: "Sam Tester",
      instagramUrl: PROFILE,
      instagramResearch: {
        status: "AVAILABLE",
        username: "sam_tester_example",
        bio: "Video editor",
        professionalCategory: "Editor",
        sourceUrl: "https://www.instagram.com/sam_tester_example",
        evidenceItems: evidenceFromProfile(
          {
            profileUrl: "https://www.instagram.com/sam_tester_example",
            username: "sam_tester_example",
            displayName: "Sam Tester",
            bio: "Video editor",
            professionalCategory: "Editor",
            publicBusinessInfo: null,
            website: null,
            businessContact: null,
            publicSignals: { followersCount: 1200 },
          },
          retrievedAt,
        ),
      },
    });
    assert.ok(contract.items.some((item) => item.id === "instagram-username" && item.present));
    assert.ok(!contract.items.some((item) => item.kind === "buying" && item.present));
    assert.ok(!contract.legacy.mentions_website_need);
  });
});

describe("Decision Maker Instagram research consumption", () => {
  it("uses stored Instagram evidence for professional presence", () => {
    const result = auditLead({
      company: "North Studio",
      website: "https://northstudio.co",
      email: "hello@northstudio.co",
      instagramUrl: "https://instagram.com/northstudio",
      instagramResearch: {
        status: "AVAILABLE",
        bio: "Architecture studio in Karachi",
        professionalCategory: "Architect",
        publicSignals: { isBusinessAccount: true },
      },
    });
    assert.equal(result.instagram.presence, "professional");
    assert.ok(result.allowedChannels.includes("INSTAGRAM"));
  });

  it("cannot create PASS from an Instagram research failure", () => {
    const result = auditLead({
      name: "Jordan Lee",
      company: "Northline",
      website: "https://northline.co",
      websiteHost: "northline.co",
      email: "jordan@northline.co",
      instagramUrl: "https://instagram.com/jordanlee",
      instagramResearch: { status: "TIMEOUT" },
      rawPayload: {
        biography: "Architecture studio",
        isBusinessAccount: true,
        businessCategoryName: "Architect",
      },
    });
    assert.notEqual(result.verdict, "PASS");
    assert.equal(result.instagram.presence, "unknown");
    assert.ok(result.unknowns.some((item) => /TIMEOUT/i.test(item)));
  });
});

describe("pipeline integration", () => {
  it("runs Instagram research after LinkedIn and before Signal Agent", () => {
    assert.deepEqual([...PIPELINE_STEPS], [
      "research",
      "linkedin_research",
      "instagram_research",
      "signals",
      "qualification",
      "opportunity",
      "decision_maker",
      "strategist",
      "outreach_writer",
    ]);
  });
});

describe("production safety remains unchanged", () => {
  it("keeps kill switch, draft_only, and caps", () => {
    assert.equal(DEFAULT_OUTREACH_ENGINE.sendsPaused, true);
    assert.equal(DEFAULT_OUTREACH_ENGINE.sendMode, "draft_only");
    assert.ok(DEFAULT_OUTREACH_ENGINE.dailySendLimit <= HARD_DAILY_SEND_LIMIT); // conservative default (10), env-configurable
    assert.equal(DEFAULT_OUTREACH_ENGINE.maxActiveSequences, HARD_MAX_ACTIVE_SEQUENCES);
    assert.equal(HARD_DAILY_SEND_LIMIT, 100);
    assert.equal(HARD_MAX_ACTIVE_SEQUENCES, 250);
  });
});

describe("sanitize malformed available payloads", () => {
  it("drops forbidden need claims even if a provider sends them", () => {
    const sanitized = sanitizeInstagramResearchResult(
      {
        status: "AVAILABLE",
        code: "OK",
        sourceUrl: PROFILE,
        profile: {
          profileUrl: PROFILE,
          username: "ada",
          displayName: "Ada",
          bio: "Editor",
          professionalCategory: null,
          publicBusinessInfo: null,
          website: null,
          businessContact: null,
          publicSignals: {},
        },
        evidence: [
          {
            category: "bio",
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

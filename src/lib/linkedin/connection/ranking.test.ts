import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canSendMessage, DECISION_FRESH_MS } from "@/lib/outreach/gate";
import { DEFAULT_OUTREACH_ENGINE, HARD_LINKEDIN_CONNECTION_DAILY_CAP, HARD_LINKEDIN_MESSAGE_DAILY_CAP } from "@/lib/outreach/policy";
import {
  LINKEDIN_CONNECTION_ELIGIBILITY_RULE,
  LINKEDIN_SALES_FUNNEL,
  SOURCE_IS_NOT_ELIGIBILITY,
  computeLinkedInRankScore,
  linkedInProspectEligibility,
  rankLinkedInProspects,
  type LinkedInProspectCandidate,
} from "@/lib/linkedin/connection/ranking";

const now = new Date();
const fresh = now;
const stale = new Date(Date.now() - DECISION_FRESH_MS - 60_000);
const PERSON = "https://www.linkedin.com/in/ada-lovelace/";
const COMPANY = "https://www.linkedin.com/company/example/";

function candidate(overrides: Partial<LinkedInProspectCandidate> = {}): LinkedInProspectCandidate {
  return {
    id: overrides.id ?? "id-1",
    leadId: overrides.leadId ?? "ZJ-1",
    name: "Ada",
    company: "Analytical Engines",
    linkedinUrl: PERSON,
    qualificationScore: 80,
    temperature: "HOT",
    auditVerdict: "PASS",
    auditedAt: fresh,
    allowedChannels: ["LINKEDIN", "EMAIL"],
    suppressed: false,
    leadStatus: "QUALIFIED",
    linkedinUrlKind: "person",
    connectionStatus: "NOT_REQUESTED",
    stopped: false,
    rejectedToday: false,
    linkedinResearchStatus: "AVAILABLE",
    hasOpportunity: true,
    hasPendingDraft: false,
    roleTitle: "Founder & CEO",
    serviceNeedStatus: "PASS",
    opportunitySelection: "PRIORITY",
    ...overrides,
  };
}

describe("LinkedIn prospect ranking eligibility", () => {
  it("requires Decision Maker PASS, a person URL, and LinkedIn as an allowed channel", () => {
    assert.equal(linkedInProspectEligibility(candidate(), "connection", now).ok, true);
    assert.equal(linkedInProspectEligibility(candidate({ auditVerdict: "HOLD" }), "connection", now).code, "DECISION_GATE");
    assert.equal(linkedInProspectEligibility(candidate({ auditVerdict: "REJECT" }), "connection", now).code, "DECISION_GATE");
    assert.equal(linkedInProspectEligibility(candidate({ auditVerdict: null }), "connection", now).code, "DECISION_MISSING");
    assert.equal(linkedInProspectEligibility(candidate({ auditedAt: stale }), "connection", now).code, "DECISION_STALE");
    assert.equal(
      linkedInProspectEligibility(candidate({ allowedChannels: ["EMAIL"] }), "connection", now).code,
      "CHANNEL_NOT_ALLOWED",
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ linkedinUrl: COMPANY, linkedinUrlKind: "company" }), "connection", now).code,
      "NOT_PERSON_URL",
    );
  });

  it("excludes suppressed, DNC, already-in-progress, rejected-today, and pending drafts", () => {
    assert.equal(linkedInProspectEligibility(candidate({ suppressed: true }), "connection", now).code, "SUPPRESSED");
    assert.equal(
      linkedInProspectEligibility(candidate({ leadStatus: "DO_NOT_CONTACT" }), "connection", now).code,
      "SUPPRESSED",
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ connectionStatus: "REQUESTED" }), "connection", now).code,
      "ALREADY_IN_PROGRESS",
    );
    assert.equal(linkedInProspectEligibility(candidate({ rejectedToday: true }), "connection", now).code, "REJECTED_TODAY");
    assert.equal(linkedInProspectEligibility(candidate({ hasPendingDraft: true }), "connection", now).code, "DRAFT_EXISTS");
    assert.equal(linkedInProspectEligibility(candidate({ stopped: true }), "connection", now).code, "LIFECYCLE_STOPPED");
    assert.equal(
      linkedInProspectEligibility(candidate({ conversationStage: "MEETING_BOOKED" }), "connection", now).code,
      "MEETING_BOOKED",
    );
    assert.equal(
      linkedInProspectEligibility(
        candidate({
          connectionStatus: "CONNECTED",
          conversationStage: "MEETING_BOOKED",
          nextEligibleMessageAt: new Date(now.getTime() - 1000),
        }),
        "message",
        now,
      ).code,
      "MEETING_BOOKED",
    );
  });

  it("allows RECOMMENDED and REQUEST_APPROVED for authorized daily connection sends", () => {
    assert.equal(
      linkedInProspectEligibility(
        candidate({ connectionStatus: "RECOMMENDED", hasPendingDraft: true }),
        "connection_send",
        now,
      ).ok,
      true,
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ connectionStatus: "REQUEST_APPROVED" }), "connection_send", now).ok,
      true,
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ connectionStatus: "REQUESTED" }), "connection_send", now).code,
      "ALREADY_IN_PROGRESS",
    );
  });

  it("never treats REQUESTED or UNKNOWN as CONNECTED for message ranking", () => {
    const due = new Date(now.getTime() - 1000);
    assert.equal(
      linkedInProspectEligibility(
        candidate({ connectionStatus: "REQUESTED", nextEligibleMessageAt: due }),
        "message",
        now,
      ).code,
      "NOT_CONNECTED",
    );
    assert.equal(
      linkedInProspectEligibility(
        candidate({ connectionStatus: "UNKNOWN", nextEligibleMessageAt: due }),
        "message",
        now,
      ).code,
      "NOT_CONNECTED",
    );
    assert.equal(
      linkedInProspectEligibility(
        candidate({ connectionStatus: "CONNECTED", nextEligibleMessageAt: due }),
        "message",
        now,
      ).ok,
      true,
    );
    assert.equal(
      linkedInProspectEligibility(
        candidate({
          connectionStatus: "CONNECTED",
          nextEligibleMessageAt: new Date(now.getTime() + 86_400_000),
        }),
        "message",
        now,
      ).code,
      "WAIT_PERIOD",
    );
  });

  it("does not treat a LinkedIn URL or discovery data as a connection recommendation", () => {
    assert.match(LINKEDIN_SALES_FUNNEL.join(" → "), /discover → enrich → research → qualify → rank → connection/i);
    assert.match(LINKEDIN_CONNECTION_ELIGIBILITY_RULE, /LinkedIn URL alone is not enough/);
    assert.match(SOURCE_IS_NOT_ELIGIBILITY, /does not make the person eligible/i);
    assert.match(SOURCE_IS_NOT_ELIGIBILITY, /Authorized discovery sources/i);
    assert.equal(
      linkedInProspectEligibility(
        candidate({
          linkedinResearchStatus: null,
          hasOpportunity: false,
          temperature: "COLD",
        }),
        "connection",
        now,
      ).code,
      "PERSON_UNVERIFIED",
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ name: "   " }), "connection", now).code,
      "PERSON_UNVERIFIED",
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ source: "invented profile" }), "connection", now).code,
      "INVENTED_PROFILE",
    );
    assert.equal(
      linkedInProspectEligibility(
        candidate({
          source: "apify scrape",
          linkedinResearchStatus: null,
          hasOpportunity: false,
          temperature: "COLD",
        }),
        "connection",
        now,
      ).code,
      "PERSON_UNVERIFIED",
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ source: "apify scrape" }), "connection", now).ok,
      true,
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ roleTitle: "Marketing Intern" }), "connection", now).code,
      "ICP_MISMATCH",
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ roleTitle: "Junior Developer" }), "connection", now).code,
      "ICP_MISMATCH",
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ roleTitle: "Full Stack Developer" }), "connection", now).code,
      "ICP_MISMATCH",
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ roleTitle: "Graphic Designer" }), "connection", now).code,
      "ICP_MISMATCH",
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ roleTitle: "HR Recruiter" }), "connection", now).code,
      "ICP_MISMATCH",
    );
    assert.equal(
      linkedInProspectEligibility(candidate({ roleTitle: "AI Automation Specialist" }), "connection", now).code,
      "ICP_MISMATCH",
    );
    assert.equal(
      linkedInProspectEligibility(
        candidate({ roleTitle: "Founder & CEO", company: "CODE DAZZLE Software" }),
        "connection",
        now,
      ).code,
      "ICP_MISMATCH",
    );
    assert.equal(
      linkedInProspectEligibility(
        candidate({ roleTitle: "CEO", company: "Acme AI Labs" }),
        "connection",
        now,
      ).code,
      "ICP_MISMATCH",
    );
    assert.equal(
      linkedInProspectEligibility(
        candidate({ roleTitle: "Owner", company: "Helsinki Dental Clinic" }),
        "connection",
        now,
      ).ok,
      true,
    );
    assert.equal(
      linkedInProspectEligibility(
        candidate({ roleTitle: "Agency Owner", company: "Bright Digital Agency" }),
        "connection",
        now,
      ).code,
      "ICP_MISMATCH",
    );
    assert.equal(
      linkedInProspectEligibility(
        candidate({
          hasOpportunity: false,
          temperature: "HOT",
          linkedinResearchStatus: "AVAILABLE",
        }),
        "connection",
        now,
      ).code,
      "NO_COMMERCIAL_RELEVANCE",
    );
  });
});

describe("LinkedIn prospect ranking order and cap", () => {
  it("ranks HOT researched opportunities ahead of a bare PASS", () => {
    const strong = computeLinkedInRankScore(candidate({ qualificationScore: 80, temperature: "HOT" }));
    const weak = computeLinkedInRankScore(
      candidate({
        qualificationScore: 80,
        temperature: "COLD",
        linkedinResearchStatus: "UNAVAILABLE",
        hasOpportunity: false,
      }),
    );
    assert.equal(strong.rankScore, 80 + 15 + 10 + 8);
    assert.equal(weak.rankScore, 80);
    assert.ok(strong.rankScore > weak.rankScore);
    const live = computeLinkedInRankScore(
      candidate({
        qualificationScore: 80,
        temperature: "COLD",
        conversationHeat: "MEETING",
        intentScore: 5,
        whyNowCount: 2,
      }),
    );
    assert.ok(live.rankScore > strong.rankScore);
  });

  it("returns at most 10 connection prospects, highest rank first", () => {
    const crowd = Array.from({ length: 15 }, (_, index) =>
      candidate({
        id: `id-${index}`,
        leadId: `ZJ-${String(index).padStart(2, "0")}`,
        qualificationScore: 50 + index,
        temperature: index === 14 ? "HOT" : "WARM",
        linkedinResearchStatus: "AVAILABLE",
        hasOpportunity: true,
      }),
    );
    const ranked = rankLinkedInProspects(crowd, { purpose: "connection", limit: 10, now });
    assert.equal(ranked.length, 10);
    assert.equal(ranked[0].leadId, "ZJ-14");
    assert.equal(ranked[0].rank, 1);
    assert.ok(ranked[0].rankScore >= ranked[9].rankScore);
    assert.equal(
      ranked.some((item) => item.leadId === "ZJ-00"),
      false,
    );
  });

  it("does not pad the daily ceiling with URL-only or unqualified prospects", () => {
    const qualified = Array.from({ length: 4 }, (_, index) =>
      candidate({
        id: `q-${index}`,
        leadId: `ZJ-Q-${index}`,
        qualificationScore: 90 - index,
      }),
    );
    const urlOnly = Array.from({ length: 12 }, (_, index) =>
      candidate({
        id: `u-${index}`,
        leadId: `ZJ-U-${String(index).padStart(2, "0")}`,
        qualificationScore: 99,
        temperature: "COLD",
        linkedinResearchStatus: "UNAVAILABLE",
        hasOpportunity: false,
      }),
    );
    const ranked = rankLinkedInProspects([...qualified, ...urlOnly], { purpose: "connection", limit: 10, now });
    assert.equal(ranked.length, 4);
    assert.deepEqual(
      ranked.map((item) => item.leadId),
      ["ZJ-Q-0", "ZJ-Q-1", "ZJ-Q-2", "ZJ-Q-3"],
    );
  });

  it("honors remaining daily slots below the hard cap", () => {
    const crowd = Array.from({ length: 8 }, (_, index) =>
      candidate({ id: `id-${index}`, leadId: `ZJ-${index}`, qualificationScore: 70 }),
    );
    const ranked = rankLinkedInProspects(crowd, { purpose: "connection", limit: 3, now });
    assert.equal(ranked.length, 3);
    assert.ok(ranked.length <= HARD_LINKEDIN_CONNECTION_DAILY_CAP);
  });

  it("does not include HOLD, company URLs, or REQUESTED leads in the connection queue", () => {
    const ranked = rankLinkedInProspects(
      [
        candidate({ id: "pass", leadId: "ZJ-PASS", qualificationScore: 60 }),
        candidate({ id: "hold", leadId: "ZJ-HOLD", auditVerdict: "HOLD", qualificationScore: 99 }),
        candidate({
          id: "co",
          leadId: "ZJ-CO",
          linkedinUrl: COMPANY,
          linkedinUrlKind: "company",
          qualificationScore: 99,
        }),
        candidate({ id: "req", leadId: "ZJ-REQ", connectionStatus: "REQUESTED", qualificationScore: 99 }),
      ],
      { purpose: "connection", limit: 10, now },
    );
    assert.deepEqual(
      ranked.map((item) => item.leadId),
      ["ZJ-PASS"],
    );
  });

  it("caps message prospects at the hard daily cap and excludes REQUESTED", () => {
    const due = new Date(now.getTime() - 1000);
    const crowd = Array.from({ length: HARD_LINKEDIN_MESSAGE_DAILY_CAP + 2 }, (_, index) =>
      candidate({
        id: `id-${index}`,
        leadId: `ZJ-M-${index}`,
        connectionStatus: "CONNECTED",
        nextEligibleMessageAt: due,
        qualificationScore: 40 + (index % 50),
      }),
    );
    crowd.push(
      candidate({
        id: "requested",
        leadId: "ZJ-REQUESTED",
        connectionStatus: "REQUESTED",
        nextEligibleMessageAt: due,
        qualificationScore: 100,
      }),
    );
    const ranked = rankLinkedInProspects(crowd, {
      purpose: "message",
      limit: HARD_LINKEDIN_MESSAGE_DAILY_CAP,
      now,
    });
    assert.equal(ranked.length, HARD_LINKEDIN_MESSAGE_DAILY_CAP);
    assert.equal(
      ranked.some((item) => item.leadId === "ZJ-REQUESTED"),
      false,
    );
  });

  it("messages a Google Sheet non-tech buyer who is already connected, even without hire language or a fresh audit", () => {
    const r = linkedInProspectEligibility(
      candidate({
        source: "google-sheets",
        serviceNeedStatus: null,
        opportunitySelection: null,
        originalPost: null,
        notes: null,
        auditVerdict: null,
        auditedAt: null,
        allowedChannels: [],
        roleTitle: "Owner",
        company: "Karachi Dental Clinic",
        industry: "dental",
        connectionStatus: "CONNECTED",
      }),
      "message_send",
      now,
    );
    assert.equal(r.ok, true, r.reason);
  });

  it("messages a 1st-degree connected non-tech founder whose title is glued into the name field", () => {
    const r = linkedInProspectEligibility(
      candidate({
        source: "linkedin_connections_message",
        name: "Oksana Farenik • 1st Turning Reed into High-Value Sustainable Products | Co-founder",
        company: null,
        roleTitle: null,
        serviceNeedStatus: null,
        opportunitySelection: null,
        originalPost: null,
        notes: "1st-degree buyer: Co-founder",
        auditVerdict: null,
        auditedAt: null,
        allowedChannels: [],
        connectionStatus: "CONNECTED",
      }),
      "message_send",
      now,
    );
    assert.equal(r.ok, true, r.reason);
  });

  it("sends a Connect invite only to a filtered sheet buyer, not a tech peer or agency", () => {
    const buyer = linkedInProspectEligibility(
      candidate({
        source: "google-sheets",
        serviceNeedStatus: null,
        opportunitySelection: null,
        originalPost: null,
        notes: null,
        auditVerdict: null,
        auditedAt: null,
        allowedChannels: [],
        linkedinResearchStatus: null,
        hasOpportunity: false,
        roleTitle: "Owner",
        company: "Karachi Dental Clinic",
        industry: "dental",
        connectionStatus: "NOT_REQUESTED",
      }),
      "connection_send",
      now,
    );
    assert.equal(buyer.ok, true, buyer.reason);
    assert.equal(
      linkedInProspectEligibility(
        candidate({
          source: "google-sheets",
          auditVerdict: null,
          allowedChannels: [],
          roleTitle: "Founder",
          company: "Acme AI Labs",
          connectionStatus: "NOT_REQUESTED",
        }),
        "connection_send",
        now,
      ).code,
      "ICP_MISMATCH",
    );
    assert.equal(
      linkedInProspectEligibility(
        candidate({
          source: "google-sheets",
          auditVerdict: null,
          allowedChannels: [],
          roleTitle: "Agency Owner",
          company: "Karachi Marketing Agency",
          connectionStatus: "NOT_REQUESTED",
        }),
        "connection_send",
        now,
      ).code,
      "ICP_MISMATCH",
    );
  });

  it("does not send Connect to a Discover REJECT just to fill the daily cap", () => {
    assert.equal(
      linkedInProspectEligibility(
        candidate({
          source: "firecrawl_fallback_search",
          auditVerdict: "REJECT",
          allowedChannels: [],
          roleTitle: "Owner",
          company: "Northline Clinic",
          connectionStatus: "NOT_REQUESTED",
        }),
        "connection_send",
        now,
      ).code,
      "DECISION_GATE",
    );
  });

  it("does not message a sheet tech peer or agency just because they are connected", () => {
    assert.equal(
      linkedInProspectEligibility(
        candidate({
          source: "google-sheets",
          serviceNeedStatus: null,
          opportunitySelection: null,
          auditVerdict: null,
          allowedChannels: [],
          roleTitle: "Founder",
          company: "Acme AI Labs",
          connectionStatus: "CONNECTED",
        }),
        "message_send",
        now,
      ).code,
      "ICP_MISMATCH",
    );
    assert.equal(
      linkedInProspectEligibility(
        candidate({
          source: "google-sheets",
          serviceNeedStatus: null,
          opportunitySelection: null,
          auditVerdict: null,
          allowedChannels: [],
          roleTitle: "Agency Owner",
          company: "Karachi Marketing Agency",
          connectionStatus: "CONNECTED",
        }),
        "message_send",
        now,
      ).code,
      "ICP_MISMATCH",
    );
  });

  it("does not change email send policy", () => {
    assert.equal(DEFAULT_OUTREACH_ENGINE.sendsPaused, true);
    assert.equal(DEFAULT_OUTREACH_ENGINE.linkedinDailyOutreach, false);
    assert.equal(DEFAULT_OUTREACH_ENGINE.sendMode, "draft_only");
    assert.equal(
      canSendMessage({
        policy: { ...DEFAULT_OUTREACH_ENGINE, sendsPaused: false, sendMode: "send_on_approve" },
        sentToday: 0,
        activeSequences: 0,
        auditVerdict: "PASS",
        auditedAt: now,
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

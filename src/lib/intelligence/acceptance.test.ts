import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluatePriorityGate, qualifyCommercial } from "./commercial";
import { classifyObserved, sealAgainstLaundering } from "./evidence";
import { evaluateCanSend, PRODUCTION_SEND_EVIDENCE } from "./send-invariant";
import { canSendMessage } from "@/lib/outreach/gate";
import { DEFAULT_OUTREACH_ENGINE } from "@/lib/outreach/policy";

const liveSend = {
  policy: { ...DEFAULT_OUTREACH_ENGINE, sendMode: "send_on_approve" as const, sendsPaused: false },
  sentToday: 0,
  activeSequences: 0,
  auditVerdict: "PASS" as const,
  auditedAt: new Date(),
  leadStatus: "QUALIFIED",
  suppressed: false,
  unsubscribed: false,
  draftStatus: "APPROVED" as const,
  channel: "EMAIL" as const,
  gmailSendConnected: true,
  sequenceStatus: "ACTIVE",
  ...PRODUCTION_SEND_EVIDENCE,
};

function fact(claim: string, url: string, snippet: string, observedAt = new Date().toISOString()) {
  return {
    claim,
    type: "FACT" as const,
    source: url,
    sourceUrl: url,
    snippet,
    timestamp: observedAt,
    observedAt,
    confidence: "high" as const,
  };
}

const priorityAviation = {
  company: "Gulf Stream Jets",
  industry: "private jet charter",
  location: "Dubai",
  website: "https://gulfstreamjets.example",
  email: "coo@gulfstreamjets.example",
  linkedinUrl: "https://linkedin.com/in/gulf-coo",
  roleTitle: "COO",
  notes: "Charter inquiries go through a generic contact form. No CRM.",
  signals: { newLocation: true, weakLanding: true, noBooking: true },
  evidence: [
    fact(
      "Company expanded charter operations into a new market.",
      "https://gulfstreamjets.example/news/riyadh",
      "Gulf Stream Jets opens Riyadh charter operations this quarter.",
    ),
    fact(
      "Charter inquiries currently appear to flow through a generic inquiry process.",
      "https://gulfstreamjets.example/contact",
      "Contact us — send a message and our team will get back to you.",
    ),
  ],
};

describe("commercial intelligence acceptance", () => {
  it("Luxury company, no Why Now → NURTURE", () => {
    const q = qualifyCommercial({
      company: "Najd Residences",
      industry: "luxury real estate developer",
      location: "Riyadh",
      email: "ceo@najd.example",
      linkedinUrl: "https://linkedin.com/in/najd-ceo",
      roleTitle: "CEO",
      highTicket: true,
      notes: "Luxury developer running Meta ads. New launch. No FACT Why Now evidence attached.",
      signals: { metaAdsActive: true, poorCreative: true, newLaunch: true, weakLanding: true, luxuryVertical: true },
    });
    assert.equal(q.brief.selection, "NURTURE");
    assert.equal(q.priority, false);
  });

  it("Score 91, no FACT evidence → NURTURE", () => {
    const q = qualifyCommercial({
      company: "Pearl Yacht Charter",
      industry: "yacht charter",
      location: "Dubai",
      email: "owner@pearl.example",
      linkedinUrl: "https://linkedin.com/in/pearl-owner",
      instagramUrl: "https://instagram.com/pearlyacht",
      roleTitle: "Owner",
      highTicket: true,
      notes: "Superyacht charter. Active Meta ads and Instagram. New summer package launch.",
      signals: {
        metaAdsActive: true,
        instagramActive: true,
        highTicketVisual: true,
        luxuryVertical: true,
        newLaunch: true,
      },
    });
    assert.equal(q.priority, false);
    assert.equal(q.brief.selection, "NURTURE");
    assert.equal(canSendMessage({ ...liveSend, commercialScore: 91, commercialPriority: false }).code, "PRIORITY_GATE");
  });

  it("Old expansion trigger → NURTURE / cannot send", () => {
    const old = new Date();
    old.setFullYear(old.getFullYear() - 2);
    const q = qualifyCommercial({
      ...priorityAviation,
      evidence: [
        fact(
          "Company expanded charter operations into a new market.",
          "https://gulfstreamjets.example/news/old",
          "Gulf Stream Jets opened Riyadh charter operations.",
          old.toISOString(),
        ),
        fact(
          "Charter inquiries currently appear to flow through a generic inquiry process.",
          "https://gulfstreamjets.example/contact",
          "Contact us — send a message and our team will get back to you.",
        ),
      ],
    });
    assert.equal(q.brief.triggerFreshness, "stale");
    assert.equal(q.priority, false);
    assert.equal(canSendMessage({ ...liveSend, triggerFreshness: "stale" }).code, "STALE_TRIGGER");
  });

  it("FACT Why Now + problem + offer + DM ≥70 → PRIORITY candidate", () => {
    const q = qualifyCommercial(priorityAviation);
    assert.equal(q.priority, true);
    assert.equal(q.brief.selection, "PRIORITY");
    assert.ok(q.brief.decisionMakerConfidence >= 70);
    assert.ok(q.brief.whyPrioritized);
    assert.equal(
      evaluatePriorityGate({
        icpConfirmed: true,
        factWhyNow: true,
        factProblem: true,
        offer: true,
        dm: true,
        staleTrigger: false,
      }).ok,
      true,
    );
  });

  it("PRIORITY + score 79 → cannot send", () => {
    assert.equal(canSendMessage({ ...liveSend, commercialScore: 79 }).code, "SCORE_BELOW_MINIMUM");
    assert.equal(
      evaluateCanSend({
        killSwitch: false,
        draftOnly: false,
        humanApproval: true,
        ...PRODUCTION_SEND_EVIDENCE,
        commercialScore: 79,
      }).ok,
      false,
    );
  });

  it("PRIORITY + score 80 + draft-only → cannot send", () => {
    assert.equal(
      canSendMessage({
        ...liveSend,
        commercialScore: 80,
        policy: { ...liveSend.policy, sendMode: "draft_only" },
      }).code,
      "DRAFT_ONLY",
    );
  });

  it("PRIORITY + score 80 + no human approval → cannot send", () => {
    assert.equal(
      canSendMessage({ ...liveSend, commercialScore: 80, draftStatus: "PENDING_APPROVAL" }).code,
      "NOT_APPROVED",
    );
  });

  it("PRIORITY + score 80 + stale trigger → cannot send", () => {
    assert.equal(
      canSendMessage({ ...liveSend, commercialScore: 80, triggerFreshness: "stale" }).code,
      "STALE_TRIGGER",
    );
  });

  it("FACT without URL or snippet is not FACT / cannot send", () => {
    assert.equal(classifyObserved({ claim: "They're expanding", sourceUrl: null, snippet: "Opened Riyadh" }).type, "HYPOTHESIS");
    assert.equal(
      classifyObserved({ claim: "They're expanding", sourceUrl: "https://news.example", snippet: "" }).type,
      "HYPOTHESIS",
    );
    assert.equal(canSendMessage({ ...liveSend, whyNowSourceUrl: "" }).code, "WHY_NOW_NO_SOURCE");
    assert.equal(canSendMessage({ ...liveSend, whyNowSnippet: "   " }).code, "WHY_NOW_NO_SNIPPET");
    assert.equal(canSendMessage({ ...liveSend, whyNowType: "INFERENCE" }).code, "WHY_NOW_NOT_FACT");
  });

  it("Inference repeated on later pass stays INFERENCE; new independent source can become FACT", () => {
    const prior = [
      {
        claim: "Company manually handles leads.",
        type: "INFERENCE" as const,
        source: "https://gulfstreamjets.example/contact",
        sourceUrl: "https://gulfstreamjets.example/contact",
        snippet: "Contact us",
        timestamp: new Date().toISOString(),
        confidence: "medium" as const,
      },
    ];
    const repeated = sealAgainstLaundering(
      {
        claim: "Company manually handles leads.",
        type: "FACT",
        source: "https://gulfstreamjets.example/contact",
        sourceUrl: "https://gulfstreamjets.example/contact",
        snippet: "Contact us",
        timestamp: new Date().toISOString(),
        confidence: "high",
      },
      prior,
    );
    assert.equal(repeated.type, "INFERENCE");
    const independent = sealAgainstLaundering(
      {
        claim: "Company manually handles leads.",
        type: "FACT",
        source: "https://careers.gulfstreamjets.example/ops",
        sourceUrl: "https://careers.gulfstreamjets.example/ops",
        snippet: "We are hiring a coordinator to manually qualify inbound charter requests.",
        timestamp: new Date().toISOString(),
        confidence: "high",
      },
      prior,
    );
    assert.equal(independent.type, "FACT");
  });

  it("All send conditions satisfied → eligible for human-approved send", () => {
    const gate = canSendMessage({ ...liveSend, commercialScore: 80 });
    assert.equal(gate.ok, true);
    assert.equal(gate.code, "OK");
  });
});

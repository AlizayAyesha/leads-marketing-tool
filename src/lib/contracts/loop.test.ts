import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseLeadInput } from "./lead-input";
import { assertSignalEvidence, parseLeadSignals } from "./signals";
import { isGenericWebsiteProblem, parseOpportunityContract } from "./opportunity";
import { parseDecisionContract } from "./decision";
import { parseOutreachAction } from "./outreach";
import { classifyEvaluation, parseOutcomeContract } from "./outcome";
import { buildLeadSignalsContract } from "../intelligence/structured-signals";
import { canEnterOutreach, canSendMessage } from "../outreach/gate";
import { DEFAULT_OUTREACH_ENGINE } from "../outreach/policy";
import { classifyReply } from "../outreach/replies";

const fresh = new Date();

describe("ingestion contracts", () => {
  it("rejects invalid or empty lead input", () => {
    assert.equal(parseLeadInput("not a record").ok, false);
    assert.equal(parseLeadInput({}).ok, false);
    assert.equal(parseLeadInput({ email: "not-an-email" }).ok, false);
  });

  it("accepts a company with a website", () => {
    const parsed = parseLeadInput({ company: "Northline Clinic", website: "https://northline.example" });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.normalized.company, "Northline Clinic");
  });
});

describe("signal contracts", () => {
  it("rejects a present signal that has no evidence", () => {
    const item = assertSignalEvidence({
      id: "buying-hiring",
      kind: "buying",
      label: "Hiring",
      present: true,
      evidence: "",
      sourceUrl: null,
    });
    assert.equal(item.present, false);
    assert.equal(item.rejected, true);
    assert.equal(item.confidence, "unknown");
  });

  it("does not invent company size without evidence", () => {
    const contract = buildLeadSignalsContract({
      leadId: "ZJ-TEST",
      company: "Acme",
      website: "https://acme.example",
      email: "ops@acme.example",
    });
    const parsed = parseLeadSignals(contract);
    assert.equal(parsed.success, true);
    const size = contract.items.find((item) => item.id === "company-size");
    assert.equal(size?.present, false);
    assert.equal(contract.company.size, null);
  });
});

describe("decision and outreach contracts", () => {
  it("allows PASS and blocks HOLD/REJECT from outreach", () => {
    const pass = parseDecisionContract({
      leadId: "ZJ-1",
      verdict: "PASS",
      reasons: ["Professional fit"],
      evidence: ["https://acme.example"],
      score: 80,
      signalIds: ["website"],
      promptVersion: 1,
      modelProvider: "heuristic",
      timestamp: fresh.toISOString(),
    });
    assert.equal(pass.success, true);
    assert.equal(canEnterOutreach({ verdict: "PASS", auditedAt: fresh, purpose: "draft" }).ok, true);
    assert.equal(canEnterOutreach({ verdict: "HOLD", auditedAt: fresh, purpose: "draft" }).ok, false);
    assert.equal(canEnterOutreach({ verdict: "REJECT", auditedAt: fresh, purpose: "send" }).ok, false);
  });

  it("keeps production send safety on", () => {
    assert.equal(
      canSendMessage({
        policy: DEFAULT_OUTREACH_ENGINE,
        sentToday: 0,
        activeSequences: 0,
        auditVerdict: "PASS",
        auditedAt: fresh,
        leadStatus: "QUALIFIED",
        suppressed: false,
        unsubscribed: false,
        draftStatus: "APPROVED",
        channel: "EMAIL",
        gmailSendConnected: true,
        sequenceStatus: "ACTIVE",
      }).code,
      "KILL_SWITCH",
    );
    assert.equal(
      canEnterOutreach({
        verdict: "PASS",
        auditedAt: fresh,
        purpose: "send",
        unsubscribed: true,
      }).code,
      "SUPPRESSED",
    );
    assert.equal(
      canSendMessage({
        policy: { ...DEFAULT_OUTREACH_ENGINE, sendsPaused: false, sendMode: "send_on_approve" },
        sentToday: 0,
        activeSequences: 0,
        auditVerdict: "PASS",
        auditedAt: fresh,
        leadStatus: "QUALIFIED",
        suppressed: false,
        unsubscribed: false,
        alreadySentDraft: true,
        draftStatus: "APPROVED",
        channel: "EMAIL",
        gmailSendConnected: true,
        sequenceStatus: "ACTIVE",
      }).code,
      "ALREADY_SENT",
    );
  });

  it("requires a decision id on the outreach action contract", () => {
    const parsed = parseOutreachAction({
      leadId: "ZJ-1",
      channel: "EMAIL",
      draft: { subject: "Note", message: "Hello" },
      evidenceRefs: ["https://acme.example"],
      decisionId: "decision-1",
      approvalStatus: "PENDING_APPROVAL",
      promptVersion: 1,
    });
    assert.equal(parsed.success, true);
  });
});

describe("opportunity and outcome contracts", () => {
  it("rejects a generic website-need problem", () => {
    assert.equal(isGenericWebsiteProblem("Company needs a website."), true);
    const parsed = parseOpportunityContract({
      leadId: "ZJ-1",
      problem: "Company needs a website.",
      evidence: [{ text: "They have a site", sourceUrl: "https://acme.example", confidence: "observed" }],
      recommendedService: "WEBSITE_DEVELOPMENT",
      confidence: "observed",
      score: 40,
      source: "sheet",
      timestamp: fresh.toISOString(),
      signalVersion: 1,
      opportunityKey: "website_modernization",
    });
    assert.equal(parsed.success, false);
  });

  it("stops the sequence on reply, meeting, and unsubscribe", () => {
    const talk = classifyReply("Let's talk");
    assert.equal(talk.stopSequence, true);
    assert.equal(talk.leadStatus, "MEETING");
    const stop = classifyReply("Please unsubscribe me");
    assert.equal(stop.suppress, true);
    assert.equal(stop.leadStatus, "DO_NOT_CONTACT");
  });

  it("classifies evaluation examples from recorded outcomes", () => {
    const base = {
      sent: true,
      delivered: null,
      replied: true,
      interested: true,
      meeting: true,
      pricing: false,
      notInterested: false,
      wrongPerson: false,
      unsubscribe: false,
      bounced: false,
      noResponse: false,
      sequenceStopped: true,
      status: "meeting" as const,
      replyIntent: "WANTS_MEETING",
      leadId: "ZJ-1",
      channel: "EMAIL" as const,
    };
    assert.equal(parseOutcomeContract(base).success, true);
    assert.equal(classifyEvaluation({ verdict: "PASS", outcome: base }), "positive");
    assert.equal(classifyEvaluation({ verdict: "PASS", outcome: { ...base, replied: false, interested: false, meeting: false } }), "neutral");
    assert.equal(classifyEvaluation({ verdict: "PASS", outcome: { ...base, notInterested: true, meeting: false, interested: false } }), "negative");
    assert.equal(classifyEvaluation({ verdict: "PASS", outcome: { ...base, wrongPerson: true } }), "bad_decision");
    assert.equal(classifyEvaluation({ verdict: "HOLD", outcome: { ...base, sent: false, replied: false } }), "safety");
  });
});

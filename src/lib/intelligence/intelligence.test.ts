import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeLead } from "../leads/normalize";
import { extractSignals } from "./signals";
import { detectOpportunity } from "./opportunity";
import { matchSolution } from "./solutions";
import { scoreFromSignals } from "./scoring";
import {
  assertExternalActionAllowed,
  canPerformExternalAction,
  canTransitionDraftTo,
  commandForbidsSending,
} from "./approval";

describe("normalization", () => {
  it("cleans email and website without inventing a company", () => {
    const row = normalizeLead({
      email: "  Ada@Example.COM ",
      website: "example.com",
    });
    assert.equal(row.email, "ada@example.com");
    assert.equal(row.website, "https://example.com/");
    assert.equal(row.company, null);
  });

  it("rejects malformed website URLs instead of coercing them", () => {
    const row = normalizeLead({ website: "ht!tp://not a url" });
    assert.equal(row.website, null);
    assert.ok(row.urlIssues.some((item) => /invalid url/i.test(item)));
  });
});

describe("signals and opportunity-before-solution", () => {
  it("does not force a service when evidence is missing", () => {
    const signals = extractSignals({});
    const opportunity = detectOpportunity(signals);
    assert.equal(opportunity.confidence, "UNKNOWN");
    assert.equal(matchSolution(opportunity), null);
  });

  it("does not treat a weak public website as a reason to sell a rebuild", () => {
    const signals = extractSignals({
      website: "https://example.com",
      linkedinUrl: "https://linkedin.com/in/x",
      websiteQuality: 3,
    });
    const opportunity = detectOpportunity(signals);
    assert.equal(opportunity.opportunityKey, "unknown");
    assert.equal(opportunity.confidence, "UNKNOWN");
    assert.equal(matchSolution(opportunity), null);
  });

  it("treats an explicit automation request as FACT", () => {
    const signals = extractSignals({
      originalPost: "Need workflow automation for invoices",
    });
    const opportunity = detectOpportunity(signals, "Need workflow automation for invoices");
    assert.equal(opportunity.confidence, "FACT");
    assert.equal(matchSolution(opportunity)?.slug, "ai_automation");
  });
});

describe("explainable scoring", () => {
  it("stays conservative without a request or contact", () => {
    const signals = extractSignals({});
    const opportunity = detectOpportunity(signals);
    const scored = scoreFromSignals(signals, opportunity);
    assert.ok(scored.score < 50);
    assert.ok(scored.risks.some((item) => item.toLowerCase().includes("unknown") || item.toLowerCase().includes("contact")));
  });
});

describe("approval gate", () => {
  it("blocks external action without APPROVED", () => {
    assert.equal(canPerformExternalAction("PENDING_APPROVAL"), false);
    assert.equal(canPerformExternalAction("APPROVED"), true);
    assert.throws(() => assertExternalActionAllowed(null), /EXTERNAL_ACTION_BLOCKED/);
  });

  it("requires an explicit approval action for approval and sending", () => {
    assert.equal(canTransitionDraftTo("PENDING_APPROVAL", "APPROVED"), false);
    assert.equal(canTransitionDraftTo("PENDING_APPROVAL", "APPROVED", { explicitApproval: true }), true);
    assert.equal(canTransitionDraftTo("PENDING_APPROVAL", "SENT", { explicitApproval: true }), false);
    assert.equal(canTransitionDraftTo("APPROVED", "SENT"), false);
    assert.equal(canTransitionDraftTo("APPROVED", "SENT", { explicitApproval: true }), true);
  });

  it("treats every draft-only phrase as a hard send prohibition", () => {
    for (const command of [
      "Do not send anything",
      "Don't send",
      "Draft only",
      "Prepare email outreach",
      "Simulate a campaign",
    ]) {
      assert.equal(commandForbidsSending(command), true, command);
    }
  });
});

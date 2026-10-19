import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commercialProspectQuote, isResearchPlaceholder, parseConversationMessages } from "@/lib/analytics/evidence";
import { classifyLeadEnvironment, isTestLeadRecord } from "@/lib/analytics/production";

describe("production lead boundary", () => {
  it("excludes e2e harness emails, sources, and fixtures", () => {
    assert.equal(
      isTestLeadRecord({
        source: "e2e-reply-harness",
        email: "jarvis-e2e-meeting-1@invalid.test",
        company: "Harvey Steel Lintels (reply harness)",
      }),
      true,
    );
    assert.equal(classifyLeadEnvironment({ source: "e2e-reply-harness" }), "TEST");
    assert.equal(isTestLeadRecord({ testRecipient: true, email: "real@company.com" }), true);
    assert.equal(isTestLeadRecord({ environment: "TEST", email: "owner@acme.com" }), true);
    assert.equal(isTestLeadRecord({ fixture: true, company: "Acme" }), true);
  });

  it("keeps ordinary production prospects", () => {
    assert.equal(
      isTestLeadRecord({
        environment: "PRODUCTION",
        source: "pdl",
        email: "ops@northline.example",
        company: "Northline Clinic",
        testRecipient: false,
        fixture: false,
      }),
      false,
    );
    assert.equal(classifyLeadEnvironment({ email: "ops@northline.example", source: "pdl" }), "PRODUCTION");
  });
});

describe("opportunity evidence", () => {
  it("does not treat research placeholders as opportunities", () => {
    assert.equal(
      isResearchPlaceholder({
        opportunityKey: "unknown",
        confidence: "UNKNOWN",
        problem: "Not enough public information to name a problem.",
      }),
      true,
    );
    assert.equal(
      commercialProspectQuote(["Not enough public information to name a problem."]),
      null,
    );
  });

  it("requires a real prospect quote with a commercial need", () => {
    const quote = commercialProspectQuote([
      "We're looking for someone to rebuild our website. The current one isn't converting.",
    ]);
    assert.ok(quote);
    assert.match(quote.quote, /rebuild our website/i);
  });

  it("reads inbound conversation messages without counting drafts", () => {
    const parsed = parseConversationMessages([
      { role: "them", text: "We're looking for someone to rebuild our website.", at: "2026-08-24T00:00:00.000Z" },
      { role: "jarvis_draft", text: "Worth a look if you want this handled properly.", at: "2026-08-24T00:01:00.000Z" },
    ]);
    assert.equal(parsed[0].role, "them");
    assert.equal(parsed[1].role, "jarvis_draft");
  });
});

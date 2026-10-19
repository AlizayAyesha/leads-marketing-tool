import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateLead } from "./evaluate";
import { listableOpportunities } from "./opportunity-listing";
import { opportunityFieldsFromEvaluation } from "./persist-opportunity-fields";

function fact(claim: string, url: string, snippet: string) {
  return {
    claim,
    type: "FACT" as const,
    source: url,
    sourceUrl: url,
    snippet,
    timestamp: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    confidence: "high" as const,
  };
}

describe("persist opportunity selection", () => {
  it("stores NURTURE when listing a company is not PRIORITY", () => {
    const evaluation = evaluateLead({
      roleTitle: "Owner",
      raw: {
        company: "Pearl Yacht Charter",
        industry: "yacht charter",
        location: "Dubai",
        email: "owner@pearl.example",
        linkedinUrl: "https://linkedin.com/in/pearl-owner",
        notes: "Superyacht charter. Active Meta ads. New summer package launch.",
      },
    });
    const fields = opportunityFieldsFromEvaluation(evaluation);
    assert.notEqual(fields.selection, "PRIORITY");
    assert.equal(fields.selection, evaluation.commercial.brief.selection);
    const listed = listableOpportunities([{ company: "Pearl Yacht Charter", selection: fields.selection }]);
    assert.equal(listed.length, 0);
  });

  it("stores REJECT and keeps it off the operator list", () => {
    const evaluation = evaluateLead({
      roleTitle: "Founder",
      raw: {
        company: "Nexus AI Studio",
        industry: "AI software agency",
        location: "Austin",
        email: "founder@nexus.example",
        notes: "We build AI products for other startups.",
      },
    });
    const fields = opportunityFieldsFromEvaluation(evaluation);
    assert.equal(fields.selection, "REJECT");
    assert.equal(
      listableOpportunities([{ company: evaluation.normalized.company, selection: fields.selection }]).length,
      0,
    );
  });

  it("lists only PRIORITY golden fields", () => {
    const evaluation = evaluateLead({
      roleTitle: "COO",
      raw: {
        company: "Gulf Stream Jets",
        industry: "private jet charter",
        location: "Dubai",
        website: "https://gulfstreamjets.example",
        email: "coo@gulfstreamjets.example",
        linkedinUrl: "https://linkedin.com/in/gulf-coo",
        notes: "Charter inquiries go through a generic contact form. No CRM.",
      },
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
    });
    const fields = opportunityFieldsFromEvaluation(evaluation);
    assert.equal(fields.selection, "PRIORITY");
    assert.match(fields.nextStep, /PRIORITY/);
    assert.ok(fields.icpId);
    const listed = listableOpportunities([
      { company: "Pearl", selection: "NURTURE" },
      { company: "Gulf Stream Jets", selection: fields.selection, who: fields.problem, offer: fields.suggestedOffer },
    ]);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.company, "Gulf Stream Jets");
  });
});

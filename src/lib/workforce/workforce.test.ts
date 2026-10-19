import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AGENT_CONTRACTS, agentMaySend } from "../agents/contracts";
import { explainQualification } from "../intelligence/explain";
import { parseWorkforceCommand, workforceStages } from "./plan";
import { isWorkforceFunnel } from "./types";

describe("operator command → task graph", () => {
  it("turns a sheet-to-drafts command into a workforce plan", () => {
    const plan = parseWorkforceCommand(
      "Take the new leads from today's Google Sheet, research them, find the strongest opportunities, prepare outreach, and show me the drafts.",
    );
    assert.ok(plan);
    assert.equal(plan.intent, "PROCESS_WORKFORCE");
    assert.equal(plan.importSheet, true);
    assert.ok(plan.stages.includes("IMPORT"));
    assert.ok(plan.stages.some((stage) => stage.startsWith("RESEARCH ×")));
    assert.ok(plan.stages.includes("WAIT FOR YOU"));
    assert.match(plan.opening, /Nothing will be sent/);
  });

  it("maps find-me-N and simulate campaign", () => {
    const find = parseWorkforceCommand("Jarvis, find me 50 companies that could potentially need Acme Studio.");
    assert.equal(find?.intent, "PROCESS_WORKFORCE");
    assert.equal(find?.limit, 50);
    assert.deepEqual(find?.stages, workforceStages(50, find?.top ?? 15));

    const simulate = parseWorkforceCommand("SIMULATE CAMPAIGN");
    assert.equal(simulate?.intent, "SIMULATE_CAMPAIGN");
    assert.equal(simulate?.simulate, true);
  });

  it("does not steal a simple import or research command", () => {
    assert.equal(parseWorkforceCommand("Import today's leads."), null);
    assert.equal(parseWorkforceCommand("Research all new leads."), null);
  });

  it("recognizes the primary full-loop command and stops at approval", () => {
    const plan = parseWorkforceCommand(
      "Process my pipeline: research the new leads, qualify them, name the business problem first, prepare the strongest opportunities, and write outreach drafts. Do not send any messages. Show me the drafts and wait for my approval.",
    );
    assert.equal(plan?.intent, "PROCESS_WORKFORCE");
    assert.equal(plan?.simulate, false);
    assert.equal(plan?.stages.at(-1), "WAIT FOR YOU");
    assert.match(plan?.opening ?? "", /Nothing will be sent/);
  });

  it("caps a requested five-lead sheet simulation", () => {
    const plan = parseWorkforceCommand("Simulate a campaign on 5 leads from the Google Sheet. Do not send.");
    assert.equal(plan?.intent, "SIMULATE_CAMPAIGN");
    assert.equal(plan?.importSheet, true);
    assert.equal(plan?.limit, 5);
  });
});

describe("capability contracts", () => {
  it("forbids every specialist from sending", () => {
    for (const contract of AGENT_CONTRACTS) {
      assert.equal(agentMaySend(contract.slug), false);
      assert.ok(contract.cannot.some((item) => /send|submit|approve/i.test(item)));
    }
  });

  it("keeps research and outreach inside their seats", () => {
    const research = AGENT_CONTRACTS.find((item) => item.slug === "research");
    const outreach = AGENT_CONTRACTS.find((item) => item.slug === "outreach_writer");
    assert.ok(research?.can.some((item) => item.includes("public webpages")));
    assert.ok(research?.cannot.some((item) => item.includes("credentials")));
    assert.ok(outreach?.can.some((item) => item.includes("drafts")));
    assert.ok(outreach?.cannot.some((item) => item.includes("fabricate")));
    assert.ok(outreach?.cannot.some((item) => item.includes("approve")));
  });
});

describe("confidence + evidence view", () => {
  it("renders FIT/NEED/INTENT plus unknowns instead of a naked score", () => {
    const view = explainQualification({
      score: 87,
      temperature: "HOT",
      reason: "Strong observable signals, but internal pain is unconfirmed.",
      breakdown: {
        fit: 22,
        need: 23,
        intent: 16,
        timing: 13,
        accessibility: 13,
        unknowns: ["Current internal workflow", "Budget"],
        risks: [
          "Need is inferred from public signals, not a stated request.",
          "No explicit buying request.",
        ],
        recommendedAction: "Prepare outreach",
      },
      evidenceUsed: ["Active hiring", "Existing web application", "Public automation discussion"],
    });
    assert.equal(view.fit, 22);
    assert.equal(view.need, 23);
    assert.equal(view.recommendedAction, "Prepare outreach");
    assert.equal(view.riskLevel, "Medium");
    assert.ok(view.unknowns.includes("Budget"));
  });
});

describe("simulation honesty", () => {
  it("only accepts a funnel that reports zero sends", () => {
    assert.equal(
      isWorkforceFunnel({
        jobId: "JOB-TEST",
        command: "simulate",
        simulate: true,
        imported: 500,
        valid: 472,
        researched: 381,
        opportunities: 214,
        qualified: 87,
        recommended: 32,
        drafts: 32,
        sent: 0,
        failed: 0,
        status: "AWAITING_YOUR_APPROVAL",
        leadIds: [],
        stages: [],
      }),
      true,
    );
    assert.equal(isWorkforceFunnel({ jobId: "x", sent: 1, status: "AWAITING_YOUR_APPROVAL" }), false);
  });
});

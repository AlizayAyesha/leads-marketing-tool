import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STRESS_FIXTURE } from "./fixture";
import { formatSimulationReport, runFixtureSimulation } from "./simulate";
import { evaluateLead } from "../intelligence/evaluate";
import { attemptExternalAction, assertExternalActionAllowed } from "../intelligence/approval";
import { mapConcurrent } from "../queue/concurrent";

describe("TEST A — 20 lead simulation", () => {
  it("processes the fixture without killing the job and sends nothing", async () => {
    const report = await runFixtureSimulation();
    assert.ok(report.totalInput >= 20, "fixture must have at least 20 rows");
    assert.equal(report.processed, report.totalInput);
    assert.equal(report.failed, 0);
    assert.ok(report.researchFailed >= 1, "at least one website failure must be recorded");
    assert.ok(report.qualified >= 1);
    assert.ok(report.drafts >= 1);
    assert.equal(report.external_messages_sent, 0);
    assert.ok(report.skipped >= 1);
    assert.doesNotThrow(() => formatSimulationReport(report));
  });
});

describe("TEST B — bad data", () => {
  it("does not manufacture reports for empty, duplicate, invalid, or thin rows", async () => {
    const report = await runFixtureSimulation();
    const byId = Object.fromEntries(report.evaluations.map((item) => [item.fixtureId, item]));

    assert.equal(byId.F13.rowStatus, "EMPTY");
    assert.equal(byId.F12.rowStatus, "DUPLICATE");
    assert.equal(byId.F10.normalized.email, null);
    assert.equal(byId.F09.normalized.website, null);
    assert.ok(byId.F09.normalized.urlIssues.length > 0);

    for (const id of ["F05", "F06", "F08", "F09", "F10", "F13", "F14", "F21"]) {
      const row = byId[id];
      assert.equal(row.shouldDraft, false, `${id} must not receive a draft`);
      assert.equal(row.solution, null, `${id} must not get a forced solution`);
      assert.ok(
        row.decision === "SKIP" ||
          row.decision === "INSUFFICIENT_EVIDENCE" ||
          row.decision === "INVALID" ||
          row.rowStatus === "EMPTY" ||
          row.rowStatus === "DUPLICATE",
        `${id} decision was ${row.decision}/${row.rowStatus}`,
      );
      assert.equal(row.opportunity.confidence === "FACT", false);
    }
  });
});

describe("TEST C — strong Acme Studio fit", () => {
  it("goes evidence → problem → opportunity → appropriate solution, not a default AI agent", async () => {
    const report = await runFixtureSimulation();
    const byId = Object.fromEntries(report.evaluations.map((item) => [item.fixtureId, item]));

    assert.equal(byId.F01.opportunity.opportunityKey, "workflow_automation");
    assert.equal(byId.F01.opportunity.confidence, "FACT");
    assert.equal(byId.F01.solution?.slug, "ai_automation");
    assert.notEqual(byId.F01.solution?.slug, "ai_agents");
    assert.equal(byId.F01.decision, "QUALIFIED");
    assert.equal(byId.F01.shouldDraft, true);

    assert.equal(byId.F02.opportunity.opportunityKey, "agentic_workflow");
    assert.equal(byId.F02.solution?.slug, "agentic_workflows");
    assert.notEqual(byId.F02.solution?.slug, "ai_agents");

    assert.equal(byId.F03.opportunity.opportunityKey, "custom_software");
    assert.equal(byId.F03.solution?.slug, "custom_software");

    assert.equal(byId.F04.opportunity.opportunityKey, "web_application");
    assert.equal(byId.F04.solution?.slug, "web_applications");
  });
});

describe("TEST D — bad prospect SKIP", () => {
  it("skips unsuitable companies with no solution, draft, or approval request", async () => {
    const report = await runFixtureSimulation();
    const byId = Object.fromEntries(report.evaluations.map((item) => [item.fixtureId, item]));
    for (const id of ["F18", "F19", "F20"]) {
      assert.equal(byId[id].decision, "SKIP", `${id} should SKIP, got ${byId[id].decision}`);
      assert.equal(byId[id].solution, null);
      assert.equal(byId[id].shouldDraft, false);
      assert.equal(byId[id].opportunity.opportunityKey, "unknown");
    }
  });
});

describe("keyword bias", () => {
  it("does not qualify leads that only mention AI / software / automation / SaaS", async () => {
    const report = await runFixtureSimulation();
    const byId = Object.fromEntries(report.evaluations.map((item) => [item.fixtureId, item]));
    for (const id of ["F15", "F16", "F17"]) {
      assert.equal(byId[id].signals.keyword_only, true, `${id} should be keyword-only`);
      assert.equal(byId[id].decision, "SKIP");
      assert.equal(byId[id].shouldDraft, false);
      assert.equal(byId[id].solution, null);
      assert.equal(byId[id].opportunity.opportunityKey, "unknown");
    }
  });
});

describe("approval safety", () => {
  it("blocks external action at the server boundary without APPROVED", () => {
    assert.throws(() => attemptExternalAction({ approvalStatus: null }), /EXTERNAL_ACTION_BLOCKED/);
    assert.throws(() => attemptExternalAction({ approvalStatus: "PENDING_APPROVAL" }), /EXTERNAL_ACTION_BLOCKED/);
    assert.throws(() => attemptExternalAction({ approvalStatus: "APPROVED" }), /NO_SEND_ADAPTER/);
    assert.throws(() => assertExternalActionAllowed("EDITED"), /EXTERNAL_ACTION_BLOCKED/);
  });
});

describe("determinism", () => {
  it("returns the same score, signals, opportunity, and solution on identical fixture data", () => {
    const row = STRESS_FIXTURE.find((item) => item.id === "F01");
    assert.ok(row);
    const a = evaluateLead({ fixtureId: row.id, raw: row.raw, snapshot: row.snapshot });
    const b = evaluateLead({ fixtureId: row.id, raw: row.raw, snapshot: row.snapshot });
    assert.deepEqual(a.signals, b.signals);
    assert.deepEqual(a.opportunity, b.opportunity);
    assert.equal(a.score.score, b.score.score);
    assert.equal(a.decision, b.decision);
    assert.equal(a.solution?.slug, b.solution?.slug);
    assert.equal(a.normalized.email, "priya@northwind-ops.fixture");
  });
});

describe("failure isolation", () => {
  it("one thrown worker does not abort the rest of the batch", async () => {
    const settled = await mapConcurrent([1, 2, 3, 4, 5], 3, async (value) => {
      if (value === 3) throw new Error("forced agent error");
      return value * 10;
    });
    assert.equal(settled.length, 5);
    assert.equal(settled[2]?.status, "rejected");
    assert.equal(settled[0]?.status, "fulfilled");
    assert.equal(settled[4]?.status, "fulfilled");
    const ok = settled.filter((item) => item.status === "fulfilled").length;
    assert.equal(ok, 4);
  });
});

describe("fixture contract vs persisted-style report", () => {
  it("matches expected decision/opportunity/draft for every fixture row from stored evaluation, not an LLM", async () => {
    const report = await runFixtureSimulation();
    const byId = Object.fromEntries(report.evaluations.map((item) => [item.fixtureId, item]));
    const failures: string[] = [];
    for (const row of STRESS_FIXTURE) {
      const got = byId[row.id];
      if (!got) {
        failures.push(`${row.id} missing`);
        continue;
      }
      if (row.expectDecision === "EMPTY" && got.rowStatus !== "EMPTY") {
        failures.push(`${row.id} expected EMPTY, got ${got.rowStatus}/${got.decision}`);
      } else if (row.expectDecision === "DUPLICATE" && got.rowStatus !== "DUPLICATE") {
        failures.push(`${row.id} expected DUPLICATE, got ${got.rowStatus}/${got.decision}`);
      } else if (row.expectDecision !== "EMPTY" && row.expectDecision !== "DUPLICATE" && got.decision !== row.expectDecision) {
        failures.push(`${row.id} expected ${row.expectDecision}, got ${got.decision} (${got.reason})`);
      }
      if (row.expectOpportunityKey && got.opportunity.opportunityKey !== row.expectOpportunityKey) {
        failures.push(`${row.id} opportunity ${got.opportunity.opportunityKey} != ${row.expectOpportunityKey}`);
      }
      if (row.expectSolutionSlug !== undefined && (got.solution?.slug ?? null) !== row.expectSolutionSlug) {
        failures.push(`${row.id} solution ${got.solution?.slug ?? "none"} != ${row.expectSolutionSlug}`);
      }
      if (got.shouldDraft !== row.expectDraft) {
        failures.push(`${row.id} draft ${got.shouldDraft} != ${row.expectDraft}`);
      }
    }
    assert.equal(failures.join("\n"), "", failures.join("\n"));
    assert.equal(report.external_messages_sent, 0);
  });
});

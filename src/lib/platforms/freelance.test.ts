import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isFreelanceCommand, matchFreelanceCommand } from "../brain/capabilities";
import { planFreelanceWork } from "../brain/planner";
import { inferService, parseBudgetAmount, qualifyOpportunity } from "./qualify-core";

describe("freelance triage", () => {
  it("routes freelance commands by capability, not by hard-coded platform logic", () => {
    const match = matchFreelanceCommand("Find me good freelance opportunities.");
    assert.equal(match?.capability, "find_freelance_opportunities");
    const plan = planFreelanceWork(match!);
    assert.ok(plan.some((task) => task.agentId === "upwork"));
    assert.ok(plan.some((task) => task.agentId === "fiverr"));
    assert.ok(plan.some((task) => task.agentId === "fiverr_intelligence"));
  });

  it("keeps marketing lead commands out of freelance triage", () => {
    assert.equal(isFreelanceCommand("Research all new leads."), false);
    assert.equal(isFreelanceCommand("Show me the top 20 leads."), false);
  });

  it("maps Upwork-only and Fiverr-only requests", () => {
    assert.equal(matchFreelanceCommand("Find Upwork projects for AI automation.")?.platform, "upwork");
    assert.equal(matchFreelanceCommand("Analyze my Fiverr gigs.")?.capability, "analyze_fiverr_gigs");
    assert.equal(matchFreelanceCommand("What are buyers buying on Fiverr?")?.capability, "analyze_fiverr_market");
    assert.equal(matchFreelanceCommand("Which platform is performing better?")?.capability, "compare_freelance_platforms");
  });
});

describe("qualification core", () => {
  it("does not invent a budget when none is present", () => {
    const result = qualifyOpportunity({
      title: "Need a website",
      description: "Looking for a marketing site rebuild with clear pages and a contact form.",
    });
    assert.equal(result.recommendedService, "WEBSITE_DEVELOPMENT");
    assert.ok(result.risks.some((item) => item.toLowerCase().includes("budget")));
    assert.ok(result.score >= 0 && result.score <= 100);
  });

  it("parses budget text without fabricating extra figures", () => {
    assert.equal(parseBudgetAmount("under $2,000"), 2000);
    assert.equal(parseBudgetAmount(null), null);
  });

  it("infers AI automation from observed keywords only", () => {
    assert.equal(inferService("Need workflow automation for invoices"), "AI_AUTOMATION");
    assert.equal(inferService("Hello there"), null);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildJarvisDoctrine } from "./doctrine";
import { JARVIS_INTERPRET_IS_ADAPTER, JARVIS_LLM_INVARIANT } from "./invariant";
import { heuristicBrainPlan, parseBrainPlan, proseFromToolFacts } from "./brain-plan";
import { executeIntentCommand } from "./execute-intent";
import { DEFAULT_MIN_COMMERCIAL_SCORE } from "@/lib/outreach/quality";
import { canSendMessage } from "@/lib/outreach/gate";
import { DEFAULT_OUTREACH_ENGINE } from "@/lib/outreach/policy";
import { PRODUCTION_SEND_EVIDENCE } from "@/lib/intelligence/send-invariant";

describe("Jarvis v1 brain policy", () => {
  it("locks the LLM invariant into doctrine", () => {
    const doctrine = buildJarvisDoctrine();
    assert.match(doctrine, new RegExp(JARVIS_LLM_INVARIANT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(doctrine, new RegExp(JARVIS_INTERPRET_IS_ADAPTER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(doctrine, new RegExp(String(DEFAULT_MIN_COMMERCIAL_SCORE)));
    assert.match(doctrine, /Postgres wins/);
    assert.match(doctrine, /Operator reasoning/);
    assert.match(doctrine, /FACT/);
    assert.match(doctrine, /vector warehouse/);
  });

  it("parses tool plans and drops unknown tools", () => {
    const plan = parseBrainPlan({
      reply: "Here is what I would do.",
      tools: [{ name: "get_analytics", args: {} }, { name: "invent_send", args: {} }],
      lastLeadId: "ZJ-1",
    });
    assert.equal(plan.tools.length, 1);
    assert.equal(plan.tools[0]?.name, "get_analytics");
    assert.equal(plan.lastLeadId, "ZJ-1");
  });

  it("routes follow-ups and send requests without treating chat as interpretCommand", () => {
    const follow = heuristicBrainPlan("Which ones?", { lastLeadId: "ZJ-99", lastDraftId: null });
    assert.equal(follow.tools[0]?.name, "get_lead");
    const send = heuristicBrainPlan("Send that.", { lastLeadId: "ZJ-99", lastDraftId: "draft-1" });
    assert.equal(send.tools[0]?.name, "request_send");
    const today = heuristicBrainPlan("What should I actually do today?", { lastLeadId: null, lastDraftId: null });
    assert.ok(today.tools.some((t) => t.name === "get_execution_brief"));
    assert.ok(!today.tools.some((t) => t.name === "execute_intent"));
    assert.match(executeIntentCommand("Research all new leads."), /Do not send/);
    const fallback = proseFromToolFacts("What should I actually do today?", "Researched today: 20. Scores ≥80 recorded today: 0.");
    assert.match(fallback, /RECOMMENDATION/);
    assert.match(fallback, /UNKNOWN/);
    assert.doesNotMatch(fallback, /imported: 20/);
  });

  it("keeps existing send gates: 74 cannot send, missing DM cannot send, kill switch cannot send", () => {
    const live = {
      policy: { ...DEFAULT_OUTREACH_ENGINE, sendMode: "send_on_approve" as const, sendsPaused: false },
      sentToday: 0,
      activeSequences: 0,
      auditVerdict: "PASS" as const,
      auditedAt: new Date(),
      leadStatus: "QUALIFIED",
      suppressed: false,
      unsubscribed: false,
      draftStatus: "APPROVED",
      channel: "EMAIL" as const,
      gmailSendConnected: true,
      sequenceStatus: "ACTIVE",
      ...PRODUCTION_SEND_EVIDENCE,
    };
    assert.equal(canSendMessage({ ...live, commercialScore: 74 }).code, "SCORE_BELOW_MINIMUM");
    assert.equal(canSendMessage({ ...live, auditVerdict: null }).code, "DECISION_MISSING");
    assert.equal(canSendMessage({ ...live, policy: { ...live.policy, sendsPaused: true } }).code, "KILL_SWITCH");
    assert.equal(canSendMessage({ ...live, quotaBypassAudit: true }).code, "QUOTA_BYPASS_AUDIT");
    assert.equal(canSendMessage(live).ok, true);
  });
});

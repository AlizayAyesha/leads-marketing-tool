import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditLooksLikeQuotaPass } from "./quality";
import { canRecordNoResponse, openClickStatus } from "./lifecycle-events";
import { analyzeReply, isPositiveIntent } from "./reply-analysis";
import { canSendMessage } from "./gate";
import { DEFAULT_OUTREACH_ENGINE } from "./policy";
import { PRODUCTION_SEND_EVIDENCE } from "@/lib/intelligence/send-invariant";

describe("quota and engagement honesty", () => {
  it("detects operator wave PASSes", () => {
    assert.equal(auditLooksLikeQuotaPass({ regionColdGmail: true }), true);
    assert.equal(auditLooksLikeQuotaPass({ linkedinWave: true }), true);
    assert.equal(auditLooksLikeQuotaPass({ serviceNeed: "ok" }, "Clean research audit"), false);
    assert.equal(auditLooksLikeQuotaPass({}, "Operator LinkedIn connection wave."), true);
  });

  it("never reports opens/clicks as zero", () => {
    assert.equal(openClickStatus(false), "NOT_AVAILABLE");
    assert.equal(canRecordNoResponse({ sequenceCompleted: false, alreadyReplied: false }), false);
    assert.equal(canRecordNoResponse({ sequenceCompleted: true, alreadyReplied: false }), true);
  });

  it("reply analysis keeps a human draft on positive mail", () => {
    const analysis = analyzeReply("This is relevant, tell me more");
    assert.equal(isPositiveIntent(analysis.intent), true);
    assert.equal(analysis.needsHumanDraft, true);
    assert.equal(analysis.openTracking, "NOT_AVAILABLE");
    assert.match(analysis.draftSuggestion.message, /Book a short meeting/);
  });

  it("blocks production send on quota audits and weak commercial scores", () => {
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
    assert.equal(canSendMessage({ ...live, quotaBypassAudit: true }).code, "QUOTA_BYPASS_AUDIT");
    assert.equal(canSendMessage({ ...live, commercialScore: 61 }).code, "SCORE_BELOW_MINIMUM");
    assert.equal(canSendMessage({ ...live, commercialScore: 82 }).ok, true);
    assert.equal(canSendMessage({ ...live, commercialPriority: false }).code, "PRIORITY_GATE");
    assert.equal(canSendMessage({ ...live, whyNowType: "INFERENCE" }).code, "WHY_NOW_NOT_FACT");
    assert.equal(canSendMessage({ ...live, whyNowSourceUrl: null }).code, "WHY_NOW_NO_SOURCE");
    assert.equal(
      canSendMessage({
        ...live,
        quotaBypassAudit: true,
        commercialScore: 40,
        testRecipientConfirmed: true,
        testRecipientSend: true,
      }).ok,
      true,
    );
  });
});

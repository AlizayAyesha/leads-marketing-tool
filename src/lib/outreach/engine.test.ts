import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commandForbidsSending } from "@/lib/intelligence/approval";
import { parseTestRecipientFlag } from "./test-flag";
import { DEFAULT_OUTREACH_ENGINE, HARD_DAILY_SEND_LIMIT, HARD_MAX_ACTIVE_SEQUENCES, mergeOutreachEnginePolicy } from "./policy";
import { PRODUCTION_SEND_EVIDENCE } from "@/lib/intelligence/send-invariant";
import { canEnterOutreach, canEnrollInSequence, canSendMessage, DECISION_FRESH_MS } from "./gate";
import { classifyReply, suggestedReply } from "./replies";

const fresh = new Date();
const stale = new Date(Date.now() - DECISION_FRESH_MS - 60_000);

const base = {
  policy: DEFAULT_OUTREACH_ENGINE,
  sentToday: 0,
  activeSequences: 0,
  auditVerdict: "PASS" as const,
  auditedAt: fresh,
  leadStatus: "QUALIFIED",
  suppressed: false,
  unsubscribed: false,
  draftStatus: "APPROVED" as const,
  channel: "EMAIL" as const,
  gmailSendConnected: true,
  sequenceStatus: "ACTIVE" as const,
};

const livePolicy = { ...DEFAULT_OUTREACH_ENGINE, sendMode: "send_on_approve" as const, sendsPaused: false };
const live = { ...base, policy: livePolicy, ...PRODUCTION_SEND_EVIDENCE };

describe("canEnterOutreach hard gate", () => {
  it("allows a fresh PASS for draft and sequence", () => {
    assert.equal(canEnterOutreach({ verdict: "PASS", auditedAt: fresh, purpose: "draft" }).ok, true);
    assert.equal(canEnterOutreach({ verdict: "PASS", auditedAt: fresh, purpose: "sequence", leadStatus: "QUALIFIED" }).ok, true);
    assert.equal(canEnrollInSequence(base).ok, true);
  });

  it("blocks HOLD from draft, sequence, follow-up, approve, and send", () => {
    for (const purpose of ["draft", "sequence", "follow_up", "approve", "send"] as const) {
      const decision = canEnterOutreach({ verdict: "HOLD", auditedAt: fresh, purpose });
      assert.equal(decision.ok, false);
      assert.equal(decision.code, "DECISION_GATE");
    }
    assert.equal(canEnrollInSequence({ ...base, auditVerdict: "HOLD" }).ok, false);
    assert.equal(canSendMessage({ ...live, auditVerdict: "HOLD" }).ok, false);
  });

  it("blocks REJECT from draft, sequence, and send", () => {
    assert.equal(canEnterOutreach({ verdict: "REJECT", auditedAt: fresh, purpose: "draft" }).ok, false);
    assert.equal(canEnrollInSequence({ ...base, auditVerdict: "REJECT" }).ok, false);
    assert.match(canSendMessage({ ...live, auditVerdict: "REJECT" }).code, /DECISION_GATE/);
  });

  it("blocks missing, malformed, and stale Decision Maker results", () => {
    assert.equal(canEnterOutreach({ verdict: null, purpose: "draft" }).code, "DECISION_MISSING");
    assert.equal(canEnterOutreach({ verdict: "pass", auditedAt: fresh, purpose: "draft" }).code, "DECISION_MISSING");
    assert.equal(canEnterOutreach({ verdict: "MAYBE", auditedAt: fresh, purpose: "sequence" }).code, "DECISION_MISSING");
    assert.equal(canEnterOutreach({ verdict: "PASS", purpose: "draft" }).code, "DECISION_STALE");
    assert.equal(canEnterOutreach({ verdict: "PASS", auditedAt: stale, purpose: "follow_up" }).code, "DECISION_STALE");
    assert.equal(canEnrollInSequence({ ...base, auditVerdict: null, auditedAt: null }).ok, false);
    assert.equal(canSendMessage({ ...live, auditVerdict: null, auditedAt: null }).ok, false);
  });

  it("blocks follow-up and re-enrollment after a reply or meeting", () => {
    assert.equal(
      canEnterOutreach({ verdict: "PASS", auditedAt: fresh, purpose: "follow_up", leadStatus: "MEETING" }).code,
      "CONVERSATION_OPEN",
    );
    assert.equal(
      canEnterOutreach({ verdict: "PASS", auditedAt: fresh, purpose: "sequence", leadStatus: "MEETING" }).ok,
      false,
    );
    assert.equal(
      canEnterOutreach({ verdict: "PASS", auditedAt: fresh, purpose: "sequence", leadStatus: "REPLIED" }).ok,
      false,
    );
    assert.equal(
      canEnterOutreach({
        verdict: "PASS",
        auditedAt: fresh,
        purpose: "sequence",
        sequenceStopReason: "UNSUBSCRIBE",
      }).code,
      "SEQUENCE_STOPPED",
    );
  });

  it("fails closed when suppression cannot be determined", () => {
    assert.equal(
      canEnterOutreach({ verdict: "PASS", auditedAt: fresh, purpose: "send", suppressionUnknown: true }).code,
      "SUPPRESSION_UNKNOWN",
    );
  });
});

describe("safety defaults", () => {
  it("does not send while the kill switch is on or mode is draft-only", () => {
    assert.equal(canSendMessage(base).code, "KILL_SWITCH");
    assert.equal(
      canSendMessage({
        ...base,
        policy: { ...DEFAULT_OUTREACH_ENGINE, sendsPaused: false },
      }).code,
      "DRAFT_ONLY",
    );
    assert.equal(
      canSendMessage({
        ...base,
        policy: { ...DEFAULT_OUTREACH_ENGINE, sendMode: "send_on_approve", sendsPaused: true },
      }).code,
      "KILL_SWITCH",
    );
    assert.equal(commandForbidsSending("Run the outreach engine. Do not send."), true);
    assert.equal(
      canSendMessage({ ...live, commandForbidsSend: commandForbidsSending("Run the outreach engine. Do not send.") }).code,
      "COMMAND_FORBIDS_SEND",
    );
  });

  it("requires explicit approval before send", () => {
    assert.equal(canSendMessage({ ...live, draftStatus: "PENDING_APPROVAL" }).code, "NOT_APPROVED");
    assert.equal(canSendMessage({ ...live, draftStatus: "APPROVED" }).ok, true);
  });

  it("blocks sends and enrollments at the hard daily ceilings", () => {
    assert.equal(canSendMessage({ ...live, sentToday: HARD_DAILY_SEND_LIMIT }).code, "DAILY_LIMIT");
    assert.equal(canSendMessage({ ...live, sentToday: HARD_DAILY_SEND_LIMIT - 1, policy: { ...livePolicy, dailySendLimit: HARD_DAILY_SEND_LIMIT } }).ok, true);
    assert.equal(canEnrollInSequence({ ...base, activeSequences: HARD_MAX_ACTIVE_SEQUENCES }).code, "SEQUENCE_CAP");
    assert.equal(canEnrollInSequence({ ...base, activeSequences: HARD_MAX_ACTIVE_SEQUENCES - 1 }).ok, true);
    const tampered = mergeOutreachEnginePolicy({ dailySendLimit: 999, maxActiveSequences: 999 });
    assert.equal(tampered.dailySendLimit, HARD_DAILY_SEND_LIMIT);
    assert.equal(tampered.maxActiveSequences, HARD_MAX_ACTIVE_SEQUENCES);
    assert.equal(
      canSendMessage({
        ...live,
        sentToday: HARD_DAILY_SEND_LIMIT,
        policy: { ...livePolicy, dailySendLimit: 999 },
      }).code,
      "DAILY_LIMIT",
    );
  });

  it("keeps LinkedIn and Instagram draft-only and Gmail required for email send", () => {
    assert.equal(canSendMessage({ ...live, channel: "LINKEDIN" }).code, "SOCIAL_SEND_BLOCKED");
    assert.equal(canSendMessage({ ...live, channel: "INSTAGRAM" }).code, "SOCIAL_SEND_BLOCKED");
    assert.equal(canSendMessage({ ...live, gmailSendConnected: false }).code, "GMAIL_NOT_CONNECTED");
  });

  it("does not enroll LinkedIn in a cold send sequence", () => {
    assert.equal(canEnrollInSequence(base).ok, true);
    assert.equal(canEnrollInSequence({ ...base, channel: "LINKEDIN" }).code, "LINKEDIN_CONNECTION_LIFECYCLE");
    assert.equal(canEnrollInSequence({ ...base, channel: "INSTAGRAM" }).ok, true);
  });

  it("does not send a draft that was already sent", () => {
    assert.equal(canSendMessage({ ...live, alreadySentDraft: true }).code, "ALREADY_SENT");
  });

  it("fails closed if policy cannot be read", () => {
    assert.equal(canSendMessage({ ...live, policyUnknown: true }).code, "POLICY_UNKNOWN");
  });
});

describe("reply handling", () => {
  it("stops the cadence on interested, pricing, not interested, wrong person, unsubscribe, and meeting", () => {
    const cases = [
      ["We're interested, tell me more", "INTERESTED"],
      ["Can you send pricing?", "NEEDS_PRICING"],
      ["Not interested, thanks", "NOT_INTERESTED"],
      ["Wrong person, I left the company", "WRONG_PERSON"],
      ["Please unsubscribe me from these emails", "UNSUBSCRIBE"],
      ["Sure, let's talk tomorrow", "WANTS_MEETING"],
    ] as const;
    for (const [text, intent] of cases) {
      const classified = classifyReply(text);
      assert.equal(classified.intent, intent);
      assert.equal(classified.stopSequence, true);
    }
  });

  it("suppresses unsubscribe and prepares a booking reply for meeting intent", () => {
    const stop = classifyReply("Please unsubscribe me from these emails");
    assert.equal(stop.suppress, true);
    assert.equal(stop.leadStatus, "DO_NOT_CONTACT");

    const meeting = classifyReply("Sure, let's talk tomorrow");
    assert.equal(meeting.intent, "WANTS_MEETING");
    assert.equal(meeting.leadStatus, "MEETING");
    const draft = suggestedReply({ intent: "WANTS_MEETING", name: "Sam", bookingUrl: "https://cal.example/zar" });
    assert.match(draft.message, /Book a short meeting here: https:\/\/cal\.example\/zar/);
    assert.equal(draft.message.includes("sequence"), false);
  });

  it("does not treat a meeting reply as a reason to enroll more outreach", () => {
    const meeting = canEnterOutreach({
      verdict: "PASS",
      auditedAt: fresh,
      purpose: "sequence",
      leadStatus: "MEETING",
    });
    assert.equal(meeting.ok, false);
  });
});

describe("queue / follow-up gates", () => {
  it("lets a due follow-up continue only for a fresh PASS that has not replied", () => {
    assert.equal(
      canEnterOutreach({
        verdict: "PASS",
        auditedAt: fresh,
        purpose: "follow_up",
        leadStatus: "CONTACTED",
      }).ok,
      true,
    );
  });

  it("blocks follow-up when Decision Maker later HOLDs or REJECTs", () => {
    assert.equal(
      canEnterOutreach({ verdict: "HOLD", auditedAt: fresh, purpose: "follow_up", leadStatus: "CONTACTED" }).ok,
      false,
    );
    assert.equal(
      canEnterOutreach({ verdict: "REJECT", auditedAt: fresh, purpose: "follow_up", leadStatus: "CONTACTED" }).ok,
      false,
    );
  });

  it("blocks follow-up after reply or unsubscribe even if PASS is still on file", () => {
    assert.equal(
      canEnterOutreach({
        verdict: "PASS",
        auditedAt: fresh,
        purpose: "follow_up",
        leadStatus: "REPLIED",
      }).ok,
      false,
    );
    assert.equal(
      canEnterOutreach({
        verdict: "PASS",
        auditedAt: fresh,
        purpose: "follow_up",
        unsubscribed: true,
      }).code,
      "SUPPRESSED",
    );
  });

  it("blocks send on kill switch even for an otherwise due follow-up", () => {
    assert.equal(
      canSendMessage({
        ...base,
        leadStatus: "CONTACTED",
        policy: DEFAULT_OUTREACH_ENGINE,
      }).code,
      "KILL_SWITCH",
    );
  });
});

describe("test recipient mode", () => {
  it("requires an explicit testRecipient or outreachTestMode flag", () => {
    assert.equal(parseTestRecipientFlag(undefined, "friend in the sheet"), false);
    assert.equal(parseTestRecipientFlag("true"), true);
    assert.equal(parseTestRecipientFlag(undefined, "testRecipient=true"), true);
    assert.equal(parseTestRecipientFlag(undefined, "outreachTestMode = true"), true);
  });
  it("does not infer a test send from kill switch being on or a HOLD verdict", () => {
    assert.equal(canSendMessage({ ...base, auditVerdict: "HOLD" }).ok, false);
    assert.equal(canEnterOutreach({ verdict: "HOLD", auditedAt: fresh, purpose: "draft" }).code, "DECISION_GATE");
  });

  it("confirmed test recipient still cannot draft production outreach on HOLD", () => {
    const draft = canEnterOutreach({
      verdict: "HOLD",
      auditedAt: fresh,
      purpose: "draft",
      testRecipientConfirmed: true,
    });
    assert.equal(draft.ok, false);
    assert.equal(draft.code, "DECISION_GATE");
    assert.equal(canSendMessage(base).code, "KILL_SWITCH");
  });

  it("sends only when testRecipientSend is explicit, still blocks DNC and social", () => {
    const allowed = canSendMessage({
      ...base,
      auditVerdict: "HOLD",
      testRecipientConfirmed: true,
      testRecipientSend: true,
    });
    assert.equal(allowed.ok, false);
    assert.equal(allowed.code, "DECISION_GATE");
    assert.equal(
      canSendMessage({
        ...live,
        auditVerdict: "PASS",
        testRecipientConfirmed: true,
        testRecipientSend: true,
        leadStatus: "DO_NOT_CONTACT",
        unsubscribed: true,
      }).code,
      "SUPPRESSED",
    );
    assert.equal(
      canSendMessage({
        ...live,
        auditVerdict: "PASS",
        testRecipientConfirmed: true,
        testRecipientSend: true,
        channel: "LINKEDIN",
      }).code,
      "SOCIAL_SEND_BLOCKED",
    );
    assert.equal(
      canSendMessage({
        ...live,
        auditVerdict: "PASS",
        testRecipientConfirmed: true,
        testRecipientSend: true,
        policy: DEFAULT_OUTREACH_ENGINE,
      }).code,
      "KILL_SWITCH",
    );
  });

  it("still stops sequences after a meeting reply even for a test recipient", () => {
    assert.equal(
      canEnterOutreach({
        verdict: "HOLD",
        auditedAt: fresh,
        purpose: "follow_up",
        leadStatus: "MEETING",
        testRecipientConfirmed: true,
      }).code,
      "CONVERSATION_OPEN",
    );
  });

  it("confirmed test recipient does not turn HOLD into production PASS", () => {
    assert.equal(
      canEnterOutreach({ verdict: "HOLD", auditedAt: fresh, purpose: "send", testRecipientConfirmed: true }).code,
      "DECISION_GATE",
    );
    assert.equal(canSendMessage({ ...live, auditVerdict: "HOLD", testRecipientConfirmed: true, testRecipientSend: true }).ok, false);
  });
});

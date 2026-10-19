import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canEnterOutreach, canSendMessage } from "./gate";
import { DEFAULT_OUTREACH_ENGINE } from "./policy";
import {
  TEST_TRANSPORT_COMMAND,
  TEST_TRANSPORT_STEP,
  TEST_TRANSPORT_SUBJECT,
  buildTestTransportEmail,
  canSendTestTransport,
  type TestTransportGateInput,
} from "./test-transport";

const fresh = new Date();
const livePolicy = { ...DEFAULT_OUTREACH_ENGINE, sendsPaused: false, sendMode: "send_on_approve" as const };
const email = buildTestTransportEmail({ name: "Sam Tester", email: "sam.tester@example.com" });

const allowed: TestTransportGateInput = {
  markedCount: 1,
  markedEmail: "sam.tester@example.com",
  markedName: "Sam Tester",
  postgresMarkedCount: 1,
  session: {
    enabled: true,
    leadId: "lead-1",
    confirmedAt: fresh.toISOString(),
    disabledAt: null,
    emailSentAt: null,
  },
  leadId: "lead-1",
  leadEmail: "sam.tester@example.com",
  leadName: "Sam Tester",
  leadTestRecipient: true,
  suppressed: false,
  unsubscribed: false,
  suppressionUnknown: false,
  leadStatus: "NEW",
  draftLeadId: "lead-1",
  draftRecipientEmail: "sam.tester@example.com",
  draftSubject: email.subject,
  draftMessage: email.message,
  draftStepKind: TEST_TRANSPORT_STEP,
  draftStatus: "PENDING_APPROVAL",
  draftAlreadySent: false,
  channel: "EMAIL",
  policy: livePolicy,
  gmailSendConnected: true,
  sentToday: 0,
  command: TEST_TRANSPORT_COMMAND,
  explicitApproval: true,
};

describe("test-only Gmail transport", () => {
  it("allows the labeled test email when every test requirement is met", () => {
    const gate = canSendTestTransport(allowed);
    assert.equal(gate.ok, true);
    assert.equal(gate.code, "TEST_TRANSPORT");
    assert.equal(email.subject, TEST_TRANSPORT_SUBJECT);
    assert.match(email.message, /controlled Jarvis infrastructure test/i);
    assert.match(email.message, /NOT a sales pitch/i);
  });

  it("normal HOLD cannot send production outreach", () => {
    assert.equal(canEnterOutreach({ verdict: "HOLD", auditedAt: fresh, purpose: "send" }).ok, false);
    assert.equal(canSendMessage({
      policy: livePolicy,
      sentToday: 0,
      activeSequences: 0,
      auditVerdict: "HOLD",
      auditedAt: fresh,
      leadStatus: "QUALIFIED",
      suppressed: false,
      unsubscribed: false,
      draftStatus: "APPROVED",
      channel: "EMAIL",
      gmailSendConnected: true,
    }).ok, false);
    assert.equal(
      canEnterOutreach({ verdict: "HOLD", auditedAt: fresh, purpose: "send", testRecipientConfirmed: true }).code,
      "DECISION_GATE",
    );
  });

  it("normal REJECT cannot send production outreach", () => {
    assert.equal(canEnterOutreach({ verdict: "REJECT", auditedAt: fresh, purpose: "send" }).code, "DECISION_GATE");
    assert.equal(canSendMessage({
      policy: livePolicy,
      sentToday: 0,
      activeSequences: 0,
      auditVerdict: "REJECT",
      auditedAt: fresh,
      leadStatus: "QUALIFIED",
      suppressed: false,
      unsubscribed: false,
      draftStatus: "APPROVED",
      channel: "EMAIL",
      gmailSendConnected: true,
    }).ok, false);
  });

  it("unmarked test recipient cannot use test path", () => {
    assert.equal(canSendTestTransport({ ...allowed, markedCount: 0, leadTestRecipient: false }).code, "TEST_RECIPIENT_UNMARKED");
  });

  it("two marked recipients cannot use test path", () => {
    assert.equal(canSendTestTransport({ ...allowed, markedCount: 2 }).code, "TEST_RECIPIENT_NOT_UNIQUE");
    assert.equal(canSendTestTransport({ ...allowed, postgresMarkedCount: 2 }).code, "TEST_RECIPIENT_NOT_UNIQUE");
  });

  it("wrong recipient cannot use test path", () => {
    assert.equal(canSendTestTransport({ ...allowed, leadId: "other" }).code, "WRONG_RECIPIENT");
    assert.equal(
      canSendTestTransport({ ...allowed, draftRecipientEmail: "someoneelse@example.com" }).code,
      "WRONG_RECIPIENT",
    );
  });

  it("suppressed recipient cannot use test path", () => {
    assert.equal(canSendTestTransport({ ...allowed, suppressed: true, leadStatus: "DO_NOT_CONTACT" }).code, "SUPPRESSED");
  });

  it("duplicate test send is blocked", () => {
    assert.equal(canSendTestTransport({ ...allowed, draftAlreadySent: true }).code, "ALREADY_SENT");
    assert.equal(canSendTestTransport({ ...allowed, session: { ...allowed.session, emailSentAt: fresh.toISOString() } }).code, "ALREADY_SENT");
  });

  it("explicit SEND TEST EMAIL approval is required", () => {
    assert.equal(canSendTestTransport({ ...allowed, command: "please send", explicitApproval: true }).code, "NOT_APPROVED");
    assert.equal(canSendTestTransport({ ...allowed, command: TEST_TRANSPORT_COMMAND, explicitApproval: false }).code, "NOT_APPROVED");
  });

  it("Gmail scope is required", () => {
    assert.equal(canSendTestTransport({ ...allowed, gmailSendConnected: false }).code, "GMAIL_NOT_CONNECTED");
  });

  it("kill switch must be off and send mode send_on_approve", () => {
    assert.equal(canSendTestTransport({ ...allowed, policy: DEFAULT_OUTREACH_ENGINE }).code, "KILL_SWITCH");
    assert.equal(
      canSendTestTransport({
        ...allowed,
        policy: { ...livePolicy, sendMode: "draft_only" },
      }).code,
      "DRAFT_ONLY",
    );
  });

  it("LinkedIn and Instagram cannot use test transport", () => {
    assert.equal(canSendTestTransport({ ...allowed, channel: "LINKEDIN" }).code, "SOCIAL_SEND_BLOCKED");
    assert.equal(canSendTestTransport({ ...allowed, channel: "INSTAGRAM" }).code, "SOCIAL_SEND_BLOCKED");
  });

  it("test session must be confirmed and is treated as disabled after send", () => {
    assert.equal(canSendTestTransport({ ...allowed, session: { ...allowed.session, confirmedAt: null } }).code, "TEST_SESSION_UNCONFIRMED");
    assert.equal(
      canSendTestTransport({
        ...allowed,
        session: { ...allowed.session, enabled: false, disabledAt: fresh.toISOString() },
      }).code,
      "TEST_SESSION_INACTIVE",
    );
  });

  it("production Decision Maker remains unchanged: HOLD/REJECT/missing/stale still block cold outreach", () => {
    assert.equal(canEnterOutreach({ verdict: "HOLD", auditedAt: fresh, purpose: "draft" }).code, "DECISION_GATE");
    assert.equal(canEnterOutreach({ verdict: "REJECT", auditedAt: fresh, purpose: "sequence" }).code, "DECISION_GATE");
    assert.equal(canEnterOutreach({ verdict: null, purpose: "send" }).code, "DECISION_MISSING");
    assert.equal(canEnterOutreach({ verdict: "PASS", purpose: "send" }).code, "DECISION_STALE");
    const transport = canSendTestTransport({ ...allowed, leadStatus: "NEW" });
    assert.equal(transport.ok, true);
    assert.notEqual(transport.code, "OK");
  });
});

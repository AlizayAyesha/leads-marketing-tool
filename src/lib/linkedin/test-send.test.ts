import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LINKEDIN_SEND_UNAVAILABLE } from "@/lib/linkedin/send/types";
import { authorizeLinkedInTestSend } from "@/lib/linkedin/test-send";

const PERSON = "https://www.linkedin.com/in/sam-tester-example/";

function ready(overrides: Partial<Parameters<typeof authorizeLinkedInTestSend>[0]> = {}) {
  return authorizeLinkedInTestSend({
    testModeEnabled: true,
    confirmedAt: "2026-08-24T00:00:00.000Z",
    sessionLeadId: "lead-1",
    leadId: "lead-1",
    testRecipient: true,
    markedTestRecipients: 1,
    killSwitchOn: false,
    sendProviderReady: true,
    linkedinUrl: PERSON,
    suppressed: false,
    leadStatus: "QUALIFIED",
    ...overrides,
  });
}

describe("authorizeLinkedInTestSend", () => {
  it("allows a confirmed test recipient when an authorized send provider is ready and the kill switch is off", () => {
    const auth = ready();
    assert.equal(auth.ok, true);
    assert.equal(auth.canSend, true);
    assert.equal(auth.code, "OK");
  });

  it("does not require Decision Maker PASS", () => {
    const auth = ready({ leadStatus: "NEW" });
    assert.equal(auth.ok, true);
  });

  it("fails closed when test mode is off, the recipient is unconfirmed, or no send provider is configured", () => {
    assert.equal(ready({ testModeEnabled: false }).code, "TEST_MODE_OFF");
    assert.equal(ready({ confirmedAt: null }).code, "RECIPIENT_UNCONFIRMED");
    assert.equal(ready({ sendProviderReady: false }).code, LINKEDIN_SEND_UNAVAILABLE);
  });

  it("keeps the global kill switch as the safety control", () => {
    const auth = ready({ killSwitchOn: true });
    assert.equal(auth.ok, false);
    assert.equal(auth.code, "KILL_SWITCH");
  });

  it("still blocks DNC and a mismatched recipient", () => {
    assert.equal(ready({ suppressed: true }).code, "DNC");
    assert.equal(ready({ leadStatus: "DO_NOT_CONTACT" }).code, "DNC");
    assert.equal(ready({ sessionLeadId: "other" }).code, "RECIPIENT_MISMATCH");
    assert.equal(ready({ testRecipient: false }).code, "RECIPIENT_MISMATCH");
    assert.equal(ready({ markedTestRecipients: 2 }).code, "RECIPIENT_MISMATCH");
  });
});

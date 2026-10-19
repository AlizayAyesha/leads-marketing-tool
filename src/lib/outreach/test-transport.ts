import { getBusinessProfile } from "@/lib/business/profile";
import type { OutreachChannel } from "@prisma/client";

import type { OutreachEnginePolicy } from "@/lib/outreach/policy";
import { HARD_DAILY_SEND_LIMIT } from "@/lib/outreach/policy";
import type { GateDecision } from "@/lib/outreach/gate";
import type { TestRecipientSession } from "@/lib/outreach/test-flag";

export const TEST_TRANSPORT_STEP = "TEST_TRANSPORT";
export const TEST_TRANSPORT_COMMAND = "SEND TEST EMAIL";
export const TEST_TRANSPORT_SUBJECT = "Jarvis test — please ignore";

function fail(code: string, reason: string): GateDecision {
  return { ok: false, code, reason };
}

export function isTestTransportCommand(command?: string | null) {
  return String(command ?? "").trim().toUpperCase() === TEST_TRANSPORT_COMMAND;
}

export function buildTestTransportEmail(input: { name?: string | null; email: string }) {
  const who = input.name?.trim() || "there";
  return {
    subject: TEST_TRANSPORT_SUBJECT,
    message: `Hi ${who},

This is a controlled Jarvis infrastructure test from your business.

It is NOT a sales pitch, NOT a service offer, and NOT a request for a meeting. No action is required. Please ignore this message.

If you received this in error, you can discard it.

— ${getBusinessProfile().businessName} (test only)`,
  };
}

export function emailsMatch(left?: string | null, right?: string | null) {
  const a = (left ?? "").trim().toLowerCase();
  const b = (right ?? "").trim().toLowerCase();
  return Boolean(a) && a === b;
}

export function namesMatch(left?: string | null, right?: string | null) {
  return (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();
}

export type TestTransportGateInput = {
  markedCount: number;
  markedEmail: string | null;
  markedName: string | null;
  postgresMarkedCount: number;
  session: Pick<TestRecipientSession, "enabled" | "leadId" | "confirmedAt" | "disabledAt" | "emailSentAt">;
  leadId: string;
  leadEmail: string | null;
  leadName: string | null;
  leadTestRecipient: boolean;
  suppressed: boolean;
  unsubscribed: boolean;
  suppressionUnknown: boolean;
  leadStatus: string;
  draftLeadId: string;
  draftRecipientEmail: string | null;
  draftSubject: string | null;
  draftMessage: string;
  draftStepKind: string | null;
  draftStatus: string | null;
  draftAlreadySent: boolean;
  channel: OutreachChannel;
  policy: OutreachEnginePolicy;
  gmailSendConnected: boolean;
  sentToday: number;
  command?: string | null;
  explicitApproval: boolean;
};

export function canSendTestTransport(input: TestTransportGateInput): GateDecision {
  if (input.suppressionUnknown) {
    return fail("SUPPRESSION_UNKNOWN", "Suppression state could not be determined. Fail closed.");
  }
  if (input.suppressed || input.unsubscribed || input.leadStatus === "DO_NOT_CONTACT") {
    return fail("SUPPRESSED", "Test transport blocked: suppressed / unsubscribe / do-not-contact.");
  }
  if (input.markedCount === 0) {
    return fail("TEST_RECIPIENT_UNMARKED", "No test recipient is marked on the Sheet.");
  }
  if (input.markedCount !== 1 || input.postgresMarkedCount !== 1) {
    return fail("TEST_RECIPIENT_NOT_UNIQUE", "Exactly one test recipient must be marked.");
  }
  if (!input.session.enabled || input.session.disabledAt) {
    return fail("TEST_SESSION_INACTIVE", "Test recipient session is not active.");
  }
  if (!input.session.confirmedAt || !input.session.leadId) {
    return fail("TEST_SESSION_UNCONFIRMED", "Confirm the test recipient identity before sending.");
  }
  if (input.session.leadId !== input.leadId || input.draftLeadId !== input.leadId) {
    return fail("WRONG_RECIPIENT", "This draft is not the confirmed test recipient.");
  }
  if (!input.leadTestRecipient) {
    return fail("TEST_RECIPIENT_UNMARKED", "This lead is not marked as the test recipient.");
  }
  if (
    !emailsMatch(input.markedEmail, input.leadEmail) ||
    !emailsMatch(input.leadEmail, input.draftRecipientEmail) ||
    !namesMatch(input.markedName, input.leadName)
  ) {
    return fail("WRONG_RECIPIENT", "Sheet identity does not match the test recipient.");
  }
  if (input.channel !== "EMAIL") {
    return fail(
      "SOCIAL_SEND_BLOCKED",
      "LinkedIn and Instagram have no official send adapter. Test transport is email-only.",
    );
  }
  if (input.draftStepKind !== TEST_TRANSPORT_STEP) {
    return fail("NOT_TEST_TRANSPORT", "This is not a labeled test-transport email.");
  }
  if (input.draftSubject !== TEST_TRANSPORT_SUBJECT || !/controlled Jarvis infrastructure test/i.test(input.draftMessage)) {
    return fail("NOT_TEST_TRANSPORT", "The email is not the labeled test-transport message.");
  }
  if (input.draftAlreadySent || input.session.emailSentAt) {
    return fail("ALREADY_SENT", "This test transport email was already sent.");
  }
  if (!input.gmailSendConnected) {
    return fail("GMAIL_NOT_CONNECTED", "Reconnect Google with Gmail send permission to email from Jarvis.");
  }
  if (input.policy.sendsPaused) {
    return fail("KILL_SWITCH", "Turn the kill switch OFF for this test, then restore it after.");
  }
  if (input.policy.sendMode !== "send_on_approve") {
    return fail("DRAFT_ONLY", "Set send mode to send_on_approve for this test, then restore draft_only.");
  }
  if (!input.explicitApproval || !isTestTransportCommand(input.command)) {
    return fail("NOT_APPROVED", `Reply ${TEST_TRANSPORT_COMMAND} to send this labeled test email.`);
  }
  if (input.sentToday >= Math.min(HARD_DAILY_SEND_LIMIT, input.policy.dailySendLimit)) {
    return fail("DAILY_LIMIT", `Daily send limit of ${Math.min(HARD_DAILY_SEND_LIMIT, input.policy.dailySendLimit)} reached.`);
  }
  return { ok: true, code: "TEST_TRANSPORT", reason: "Test-only Gmail transport may send this labeled email once." };
}

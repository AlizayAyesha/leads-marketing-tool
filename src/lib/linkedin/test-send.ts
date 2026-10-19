import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import {
  LINKEDIN_SEND_UNAVAILABLE,
  LINKEDIN_SEND_UNAVAILABLE_REASON,
  type LinkedInSendKind,
} from "@/lib/linkedin/send/types";

export type LinkedInTestSendAuthorization = {
  ok: boolean;
  canSend: boolean;
  code: string;
  reason: string;
};

export function authorizeLinkedInTestSend(input: {
  testModeEnabled: boolean;
  confirmedAt?: string | null;
  sessionLeadId?: string | null;
  leadId: string;
  testRecipient: boolean;
  markedTestRecipients: number;
  killSwitchOn: boolean;
  sendProviderReady: boolean;
  linkedinUrl?: string | null;
  suppressed?: boolean;
  leadStatus?: string | null;
}): LinkedInTestSendAuthorization {
  if (!input.testModeEnabled) {
    return {
      ok: false,
      canSend: false,
      code: "TEST_MODE_OFF",
      reason: "Test mode is off. Confirm a designated test recipient before any LinkedIn test send.",
    };
  }
  if (!input.confirmedAt) {
    return {
      ok: false,
      canSend: false,
      code: "RECIPIENT_UNCONFIRMED",
      reason: "Confirm the test recipient identity before sending.",
    };
  }
  if (!input.testRecipient || input.sessionLeadId !== input.leadId || input.markedTestRecipients !== 1) {
    return {
      ok: false,
      canSend: false,
      code: "RECIPIENT_MISMATCH",
      reason: "This lead is not the confirmed, unique test recipient.",
    };
  }
  if (input.suppressed || input.leadStatus === "DO_NOT_CONTACT") {
    return {
      ok: false,
      canSend: false,
      code: "DNC",
      reason: "Do-not-contact / suppressed. The test path still will not send.",
    };
  }
  if (input.killSwitchOn) {
    return {
      ok: false,
      canSend: false,
      code: "KILL_SWITCH",
      reason: "Global kill switch is on. It remains the safety control for test sends too.",
    };
  }
  if (!input.sendProviderReady) {
    return {
      ok: false,
      canSend: false,
      code: LINKEDIN_SEND_UNAVAILABLE,
      reason: LINKEDIN_SEND_UNAVAILABLE_REASON,
    };
  }
  if (inspectLinkedInUrl(input.linkedinUrl).kind !== "person") {
    return {
      ok: false,
      canSend: false,
      code: "NOT_PERSON_URL",
      reason: "Test LinkedIn send needs a person LinkedIn profile URL.",
    };
  }
  return {
    ok: true,
    canSend: true,
    code: "OK",
    reason: "Isolated LinkedIn test send is authorized. Production Decision Maker is unchanged.",
  };
}

export function linkedInTestIdempotencyKey(input: {
  leadId: string;
  kind: LinkedInSendKind;
  day: string;
}) {
  return `${input.leadId}:LINKEDIN:TEST:${input.kind}:${input.day}`;
}

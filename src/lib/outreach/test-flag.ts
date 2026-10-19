export const TEST_RECIPIENT_SESSION_KEY = "outreach.testRecipient";

export type LinkedInTestSendRecord = {
  kind: "connection" | "message";
  provider: string;
  externalId: string | null;
  sentAt: string;
  code: string;
  reason: string;
};

export type TestRecipientSession = {
  enabled: boolean;
  leadId: string | null;
  publicLeadId: string | null;
  confirmedAt: string | null;
  emailDraftId: string | null;
  emailSentAt: string | null;
  emailGmailMessageId: string | null;
  linkedinStatus: "idle" | "draft" | "unavailable" | "sent";
  instagramStatus: "idle" | "draft" | "unavailable";
  lastLinkedinTest: LinkedInTestSendRecord | null;
  disabledAt: string | null;
};

export const DEFAULT_TEST_SESSION: TestRecipientSession = {
  enabled: false,
  leadId: null,
  publicLeadId: null,
  confirmedAt: null,
  emailDraftId: null,
  emailSentAt: null,
  emailGmailMessageId: null,
  linkedinStatus: "idle",
  instagramStatus: "idle",
  lastLinkedinTest: null,
  disabledAt: null,
};

export function parseTestRecipientFlag(value?: string | boolean | null, notes?: string | null) {
  if (value === true) return true;
  const cell = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "1", "y"].includes(cell)) return true;
  return /\b(testRecipient|outreachTestMode)\s*=\s*true\b/i.test(notes ?? "");
}

export function mergeTestRecipientSession(raw: unknown): TestRecipientSession {
  if (!raw || typeof raw !== "object") return DEFAULT_TEST_SESSION;
  const value = raw as Partial<TestRecipientSession>;
  return {
    ...DEFAULT_TEST_SESSION,
    ...value,
    enabled: value.enabled === true,
    leadId: typeof value.leadId === "string" ? value.leadId : null,
    publicLeadId: typeof value.publicLeadId === "string" ? value.publicLeadId : null,
    confirmedAt: typeof value.confirmedAt === "string" ? value.confirmedAt : null,
    emailDraftId: typeof value.emailDraftId === "string" ? value.emailDraftId : null,
    emailSentAt: typeof value.emailSentAt === "string" ? value.emailSentAt : null,
    emailGmailMessageId: typeof value.emailGmailMessageId === "string" ? value.emailGmailMessageId : null,
    linkedinStatus:
      value.linkedinStatus === "draft" || value.linkedinStatus === "unavailable" || value.linkedinStatus === "sent"
        ? value.linkedinStatus
        : "idle",
    instagramStatus: value.instagramStatus === "draft" || value.instagramStatus === "unavailable" ? value.instagramStatus : "idle",
    lastLinkedinTest: mergeLastLinkedinTest(value.lastLinkedinTest),
    disabledAt: typeof value.disabledAt === "string" ? value.disabledAt : null,
  };
}

function mergeLastLinkedinTest(raw: unknown): LinkedInTestSendRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<LinkedInTestSendRecord>;
  if (value.kind !== "connection" && value.kind !== "message") return null;
  if (typeof value.sentAt !== "string" || typeof value.provider !== "string") return null;
  return {
    kind: value.kind,
    provider: value.provider,
    externalId: typeof value.externalId === "string" ? value.externalId : null,
    sentAt: value.sentAt,
    code: typeof value.code === "string" ? value.code : "UNKNOWN",
    reason: typeof value.reason === "string" ? value.reason : "",
  };
}

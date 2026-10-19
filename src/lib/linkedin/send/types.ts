export type LinkedInSendKind = "connection" | "message";

export type LinkedInActionEvidence = {
  leadId: string;
  profileUrl: string;
  action: string;
  at: string;
  result: string;
  observedState?: string | null;
  profileId?: string | null;
  excerpt?: string | null;
  screenshotPath?: string | null;
  url?: string | null;
  title?: string | null;
};

export type LinkedInSendRequest = {
  leadId: string;
  profileUrl: string;
  kind: LinkedInSendKind;
  body: string;
  idempotencyKey: string;
};

export type LinkedInSendResult = {
  ok: boolean;
  sent: boolean;
  code: string;
  reason: string;
  provider: string;
  externalId?: string | null;
  evidence?: LinkedInActionEvidence;
};

export type LinkedInSendProvider = {
  id: string;
  configured: boolean;
  send(request: LinkedInSendRequest): Promise<LinkedInSendResult>;
};

export const LINKEDIN_SEND_UNAVAILABLE = "LINKEDIN_SEND_UNAVAILABLE";
export const LINKEDIN_SEND_UNAVAILABLE_REASON =
  "LinkedIn sending unavailable — connect Jarvis Chrome with your signed-in LinkedIn account.";

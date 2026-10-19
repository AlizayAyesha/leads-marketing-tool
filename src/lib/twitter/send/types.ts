export type TwitterSendKind = "dm";

export type TwitterActionEvidence = {
  leadId: string;
  profileUrl: string;
  action: string;
  at: string;
  result: string;
  observedState?: string | null;
  handle?: string | null;
  excerpt?: string | null;
  screenshotPath?: string | null;
  url?: string | null;
  title?: string | null;
  followed?: boolean;
};

export type TwitterSendRequest = {
  leadId: string;
  profileUrl: string;
  kind: TwitterSendKind;
  body: string;
  idempotencyKey: string;
};

export type TwitterSendResult = {
  ok: boolean;
  sent: boolean;
  code: string;
  reason: string;
  provider: string;
  externalId?: string | null;
  evidence?: TwitterActionEvidence;
};

export type TwitterSendProvider = {
  id: string;
  configured: boolean;
  send(request: TwitterSendRequest): Promise<TwitterSendResult>;
};

export const TWITTER_SEND_UNAVAILABLE = "TWITTER_SEND_UNAVAILABLE";
export const TWITTER_SEND_UNAVAILABLE_REASON =
  "X sending unavailable — connect Jarvis Chrome and sign into x.com in that window.";

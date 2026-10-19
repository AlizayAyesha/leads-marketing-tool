export const LINKEDIN_CONNECTION_STATUSES = [
  "NOT_REQUESTED",
  "RECOMMENDED",
  "REQUEST_APPROVED",
  "REQUESTED",
  "CONNECTED",
  "DECLINED",
  "UNKNOWN",
] as const;

export type LinkedInConnectionStatus = (typeof LINKEDIN_CONNECTION_STATUSES)[number];

export const LINKEDIN_CONNECTION_PROVIDER_RESULTS = ["CONNECTED", "PENDING", "DECLINED", "UNKNOWN"] as const;
export type LinkedInConnectionProviderResult = (typeof LINKEDIN_CONNECTION_PROVIDER_RESULTS)[number];

export const LINKEDIN_CONNECT_STEP = "LINKEDIN_CONNECT";
export const LINKEDIN_POST_CONNECTION_STEP = "LINKEDIN_POST_CONNECTION";

export const LINKEDIN_CONNECTION_EVENTS = {
  RECOMMENDED: "LINKEDIN_CONNECT_RECOMMENDED",
  APPROVED: "LINKEDIN_CONNECT_APPROVED",
  REQUESTED: "LINKEDIN_CONNECT_REQUESTED",
  CHECKED: "LINKEDIN_CONNECTION_STATUS_CHECKED",
  CONNECTED: "LINKEDIN_CONNECTED",
  DECLINED: "LINKEDIN_DECLINED",
  UNKNOWN: "LINKEDIN_STATUS_UNKNOWN",
  MESSAGE_RECOMMENDED: "LINKEDIN_MESSAGE_RECOMMENDED",
  STOPPED: "LINKEDIN_CONNECTION_STOPPED",
  SENT: "LINKEDIN_CONNECTION_SENT",
} as const;

export type LinkedInConnectionAction =
  | "recommend"
  | "approve"
  | "confirm_requested"
  | "apply_status"
  | "recommend_message"
  | "stop"
  | "mark_connected"
  | "record_authorized_send";

export type TransitionDecision = {
  ok: boolean;
  from: LinkedInConnectionStatus;
  to: LinkedInConnectionStatus;
  code: string;
  reason: string;
  nextEligibleMessageAt?: string | null;
};

export type ConnectionMachineInput = {
  status: LinkedInConnectionStatus | null;
  stopped?: boolean;
  suppressed?: boolean;
  leadStatus?: string | null;
  auditVerdict?: string | null;
  auditedAt?: Date | string | null;
  allowedChannels?: string[] | null;
  linkedinUrlKind?: string | null;
  now?: Date;
  connectedAt?: Date | string | null;
  nextEligibleMessageAt?: Date | string | null;
  waitDays?: number;
  providerConfigured?: boolean;
  providerResult?: LinkedInConnectionProviderResult | null;
  hasPendingConnectDraft?: boolean;
  hasPendingMessageDraft?: boolean;
  linkedinDraftsEnabled?: boolean;
  connectionsToday?: number;
  messagesToday?: number;
  connectionDailyCap?: number;
  messageDailyCap?: number;
};

export function isLinkedInConnectionStatus(value: unknown): value is LinkedInConnectionStatus {
  return typeof value === "string" && (LINKEDIN_CONNECTION_STATUSES as readonly string[]).includes(value);
}

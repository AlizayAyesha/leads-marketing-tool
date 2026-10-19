import {
  HARD_LINKEDIN_CONNECTION_DAILY_CAP,
  HARD_LINKEDIN_MESSAGE_DAILY_CAP,
} from "@/lib/outreach/policy";

export type LinkedInDailyQuota = {
  connectionsToday: number;
  messagesToday: number;
  connectionsRemaining: number;
  messagesRemaining: number;
  connectionCap: number;
  messageCap: number;
};

export function clampLinkedInDailyCap(value: unknown, hard: number, fallback: number) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hard, Math.max(0, Math.trunc(n)));
}

export function countsTowardLinkedInDailyQuota(status: string | null | undefined) {
  return status !== "REJECTED" && status !== "SUPERSEDED";
}

export function countLinkedInQuotaDrafts(drafts: Array<{ status: string }>) {
  return drafts.filter((draft) => countsTowardLinkedInDailyQuota(draft.status)).length;
}

export function linkedInDailyQuota(input: {
  connectionsToday: number;
  messagesToday: number;
  connectionCap?: number;
  messageCap?: number;
}): LinkedInDailyQuota {
  const connectionCap = clampLinkedInDailyCap(
    input.connectionCap,
    HARD_LINKEDIN_CONNECTION_DAILY_CAP,
    HARD_LINKEDIN_CONNECTION_DAILY_CAP,
  );
  const messageCap = clampLinkedInDailyCap(
    input.messageCap,
    HARD_LINKEDIN_MESSAGE_DAILY_CAP,
    HARD_LINKEDIN_MESSAGE_DAILY_CAP,
  );
  const connectionsToday = Math.max(0, Math.trunc(input.connectionsToday) || 0);
  const messagesToday = Math.max(0, Math.trunc(input.messagesToday) || 0);
  return {
    connectionsToday,
    messagesToday,
    connectionCap,
    messageCap,
    connectionsRemaining: Math.max(0, connectionCap - connectionsToday),
    messagesRemaining: Math.max(0, messageCap - messagesToday),
  };
}

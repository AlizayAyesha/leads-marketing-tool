export type LinkedInDailySkip = {
  id?: string;
  leadId: string;
  kind: "connection" | "message";
  code: string;
  reason: string;
};

export type LinkedInDailySnapshot = {
  lastRunAt: string | null;
  nextRunAt: string | null;
  resetAt: string;
  code: string;
  reason: string;
  sendAvailable: boolean;
  connectionsSent: number;
  messagesSent: number;
  qualifiedConnections: number;
  qualifiedMessages: number;
  errors: string[];
  skipped: LinkedInDailySkip[];
};

export function emptyLinkedInDailySnapshot(input: {
  now?: Date;
  resetAt?: Date;
  code?: string;
  reason?: string;
  sendAvailable?: boolean;
}): LinkedInDailySnapshot {
  const now = input.now ?? new Date();
  const reset = input.resetAt ?? nextLinkedInReset(now);
  return {
    lastRunAt: null,
    nextRunAt: null,
    resetAt: reset.toISOString(),
    code: input.code ?? "IDLE",
    reason: input.reason ?? "LinkedIn Daily Outreach has not run yet.",
    sendAvailable: input.sendAvailable ?? false,
    connectionsSent: 0,
    messagesSent: 0,
    qualifiedConnections: 0,
    qualifiedMessages: 0,
    errors: [],
    skipped: [],
  };
}

export function nextLinkedInReset(now = new Date()) {
  const next = new Date(now);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + 1);
  return next;
}

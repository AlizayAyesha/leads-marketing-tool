export const OUTREACH_ENGINE_KEY = "outreach.engine";

export type OutreachSendMode = "draft_only" | "send_on_approve" | "auto";

export type SequenceStepKind = "INITIAL" | "FOLLOW_UP_SHORT" | "FOLLOW_UP_VALUE" | "FOLLOW_UP_FINAL";

export type OutreachEnginePolicy = {
  enabled: boolean;
  sendsPaused: boolean;
  sendMode: OutreachSendMode;
  dailySendLimit: number;
  maxActiveSequences: number;
  sequenceDays: [number, number, number, number];
  bookingUrl: string;
  emailEnabled: boolean;
  linkedinDrafts: boolean;
  instagramDrafts: boolean;
  /** X / Twitter drafts from intent discovery. */
  twitterDrafts: boolean;
  /** Operator-authorized daily X DMs via Jarvis Chrome. Default off. */
  twitterDailyOutreach: boolean;
  twitterDmDailyCap: number;
  postConnectionWaitDays: number;
  linkedinConnectionDailyCap: number;
  linkedinMessageDailyCap: number;
  /** Operator-authorized daily LinkedIn outreach. Qualification gates still apply. Default off. */
  linkedinDailyOutreach: boolean;
};

/** Bulk outreach ceilings — policy cannot exceed these. */
export const HARD_DAILY_SEND_LIMIT = 100;
export const HARD_MAX_ACTIVE_SEQUENCES = 250;
export const HARD_LINKEDIN_CONNECTION_DAILY_CAP = 100;
export const HARD_LINKEDIN_MESSAGE_DAILY_CAP = 100;
export const HARD_TWITTER_DM_DAILY_CAP = 100;

/** Conservative out-of-the-box daily cap (README: ≤10/day). Raise via env, never above the HARD_* ceilings. */
export const CONSERVATIVE_DAILY_DEFAULT = 10;

export function envCap(name: string, hard: number, env: NodeJS.ProcessEnv = process.env) {
  const parsed = Number.parseInt(env[name] ?? "", 10);
  const value = Number.isFinite(parsed) ? parsed : CONSERVATIVE_DAILY_DEFAULT;
  return Math.min(hard, Math.max(0, value));
}

export const DEFAULT_OUTREACH_ENGINE: OutreachEnginePolicy = {
  enabled: true,
  sendsPaused: true,
  sendMode: "draft_only",
  dailySendLimit: envCap("JARVIS_DAILY_SEND_LIMIT", HARD_DAILY_SEND_LIMIT),
  maxActiveSequences: HARD_MAX_ACTIVE_SEQUENCES,
  sequenceDays: [0, 3, 7, 14],
  bookingUrl: "",
  emailEnabled: true,
  linkedinDrafts: true,
  instagramDrafts: true,
  twitterDrafts: true,
  twitterDailyOutreach: false,
  twitterDmDailyCap: envCap("JARVIS_TWITTER_DM_DAILY_CAP", HARD_TWITTER_DM_DAILY_CAP),
  postConnectionWaitDays: 2,
  linkedinConnectionDailyCap: envCap("JARVIS_LINKEDIN_CONNECTION_DAILY_CAP", HARD_LINKEDIN_CONNECTION_DAILY_CAP),
  linkedinMessageDailyCap: envCap("JARVIS_LINKEDIN_MESSAGE_DAILY_CAP", HARD_LINKEDIN_MESSAGE_DAILY_CAP),
  linkedinDailyOutreach: false,
};

export const SEQUENCE_KINDS: SequenceStepKind[] = [
  "INITIAL",
  "FOLLOW_UP_SHORT",
  "FOLLOW_UP_VALUE",
  "FOLLOW_UP_FINAL",
];

export function mergeOutreachEnginePolicy(raw: unknown): OutreachEnginePolicy {
  if (!raw || typeof raw !== "object") return DEFAULT_OUTREACH_ENGINE;
  const value = raw as Partial<OutreachEnginePolicy>;
  const days = Array.isArray(value.sequenceDays) ? value.sequenceDays : DEFAULT_OUTREACH_ENGINE.sequenceDays;
  return {
    ...DEFAULT_OUTREACH_ENGINE,
    ...value,
    sequenceDays: [
      Number(days[0] ?? 0),
      Number(days[1] ?? 3),
      Number(days[2] ?? 7),
      Number(days[3] ?? 14),
    ],
    dailySendLimit: Math.min(
      HARD_DAILY_SEND_LIMIT,
      Math.max(0, Number(value.dailySendLimit ?? DEFAULT_OUTREACH_ENGINE.dailySendLimit)),
    ),
    maxActiveSequences: Math.min(
      HARD_MAX_ACTIVE_SEQUENCES,
      Math.max(1, Number(value.maxActiveSequences ?? DEFAULT_OUTREACH_ENGINE.maxActiveSequences)),
    ),
    sendMode:
      value.sendMode === "send_on_approve" || value.sendMode === "auto" || value.sendMode === "draft_only"
        ? value.sendMode
        : "draft_only",
    postConnectionWaitDays: Math.min(30, Math.max(1, Number(value.postConnectionWaitDays ?? DEFAULT_OUTREACH_ENGINE.postConnectionWaitDays) || 2)),
    linkedinConnectionDailyCap: Math.min(
      HARD_LINKEDIN_CONNECTION_DAILY_CAP,
      Math.max(0, Number(value.linkedinConnectionDailyCap ?? DEFAULT_OUTREACH_ENGINE.linkedinConnectionDailyCap) || 0),
    ),
    linkedinMessageDailyCap: Math.min(
      HARD_LINKEDIN_MESSAGE_DAILY_CAP,
      Math.max(0, Number(value.linkedinMessageDailyCap ?? DEFAULT_OUTREACH_ENGINE.linkedinMessageDailyCap) || 0),
    ),
    linkedinDailyOutreach: value.linkedinDailyOutreach === true,
    twitterDrafts: value.twitterDrafts !== false,
    twitterDailyOutreach: value.twitterDailyOutreach === true,
    twitterDmDailyCap: Math.min(
      HARD_TWITTER_DM_DAILY_CAP,
      Math.max(0, Number(value.twitterDmDailyCap ?? DEFAULT_OUTREACH_ENGINE.twitterDmDailyCap) || 0),
    ),
  };
}

export function sequencePlan(now = new Date(), days: [number, number, number, number] = DEFAULT_OUTREACH_ENGINE.sequenceDays) {
  return SEQUENCE_KINDS.map((kind, index) => ({
    stepIndex: index,
    kind,
    dueAt: new Date(now.getTime() + days[index] * 24 * 60 * 60 * 1000),
  }));
}

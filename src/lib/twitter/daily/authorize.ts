import type { OutreachEnginePolicy } from "@/lib/outreach/policy";
import { TWITTER_SEND_UNAVAILABLE, TWITTER_SEND_UNAVAILABLE_REASON } from "@/lib/twitter/send/types";

export type TwitterDailyAuthorization = {
  ok: boolean;
  canSend: boolean;
  code: string;
  reason: string;
};

export function authorizeTwitterDailyOutreach(input: {
  policy?: OutreachEnginePolicy | null;
  sendProviderConfigured: boolean;
}): TwitterDailyAuthorization {
  const policy = input.policy;
  if (!policy) {
    return {
      ok: false,
      canSend: false,
      code: "CONFIG_AMBIGUOUS",
      reason: "Outreach policy is missing. Fail closed — no X sending.",
    };
  }
  if (policy.sendsPaused) {
    return {
      ok: false,
      canSend: false,
      code: "KILL_SWITCH",
      reason: "Global kill switch is on. X daily outreach cannot send.",
    };
  }
  if (policy.twitterDailyOutreach !== true) {
    return {
      ok: false,
      canSend: false,
      code: "DAILY_OUTREACH_OFF",
      reason: "X Daily Outreach is OFF. No DMs will be sent.",
    };
  }
  if (policy.twitterDrafts === false) {
    return {
      ok: false,
      canSend: false,
      code: "CHANNEL_OFF",
      reason: "X / Twitter channel drafts are disabled.",
    };
  }
  if (!input.sendProviderConfigured) {
    return {
      ok: false,
      canSend: false,
      code: TWITTER_SEND_UNAVAILABLE,
      reason: TWITTER_SEND_UNAVAILABLE_REASON,
    };
  }
  return {
    ok: true,
    canSend: true,
    code: "OK",
    reason: "Operator authorized today's X outreach. Qualification gates still apply.",
  };
}

export function twitterDailyIdempotencyKey(input: { leadId: string; day: string }) {
  return `${input.leadId}:X_TWITTER:dm:${input.day}`;
}

export function twitterLocalDayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfTwitterLocalDay(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

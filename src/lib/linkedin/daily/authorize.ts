import type { OutreachEnginePolicy } from "@/lib/outreach/policy";
import {
  LINKEDIN_SEND_UNAVAILABLE,
  LINKEDIN_SEND_UNAVAILABLE_REASON,
} from "@/lib/linkedin/send/types";

export type LinkedInDailyAuthorization = {
  ok: boolean;
  canSend: boolean;
  code: string;
  reason: string;
};

export function authorizeLinkedInDailyOutreach(input: {
  policy?: OutreachEnginePolicy | null;
  sendProviderConfigured: boolean;
}): LinkedInDailyAuthorization {
  const policy = input.policy;
  if (!policy) {
    return {
      ok: false,
      canSend: false,
      code: "CONFIG_AMBIGUOUS",
      reason: "Outreach policy is missing. Fail closed — no LinkedIn sending.",
    };
  }
  if (policy.sendsPaused) {
    return {
      ok: false,
      canSend: false,
      code: "KILL_SWITCH",
      reason: "Global kill switch is on. LinkedIn daily outreach cannot send.",
    };
  }
  if (policy.linkedinDailyOutreach !== true) {
    return {
      ok: false,
      canSend: false,
      code: "DAILY_OUTREACH_OFF",
      reason: "LinkedIn Daily Outreach is OFF. No connections or LinkedIn messages.",
    };
  }
  if (policy.linkedinDrafts === false) {
    return {
      ok: false,
      canSend: false,
      code: "CHANNEL_OFF",
      reason: "LinkedIn channel is disabled.",
    };
  }
  if (!input.sendProviderConfigured) {
    return {
      ok: false,
      canSend: false,
      code: LINKEDIN_SEND_UNAVAILABLE,
      reason: LINKEDIN_SEND_UNAVAILABLE_REASON,
    };
  }
  return {
    ok: true,
    canSend: true,
    code: "OK",
    reason: "Operator authorized today's LinkedIn outreach. Qualification gates still apply.",
  };
}

export function linkedInDailyIdempotencyKey(input: {
  leadId: string;
  kind: "connection" | "message";
  day: string;
}) {
  return `${input.leadId}:LINKEDIN:${input.kind}:${input.day}`;
}

export function linkedInLocalDayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfLinkedInLocalDay(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

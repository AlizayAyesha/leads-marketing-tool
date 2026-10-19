import { shouldHaltOutreachForMeeting } from "@/lib/conversation/booking";
import type { ConversationStage } from "@/lib/conversation/types";
import {
  linkedInProspectEligibility,
  type LinkedInProspectCandidate,
  type RankedLinkedInProspect,
} from "@/lib/linkedin/connection/ranking";
import {
  authorizeLinkedInDailyOutreach,
  linkedInDailyIdempotencyKey,
  linkedInLocalDayKey,
} from "@/lib/linkedin/daily/authorize";
import { composeLinkedInConnectionNote, composeLinkedInFollowUpMessage } from "@/lib/linkedin/daily/copy";
import type { LinkedInDailySkip } from "@/lib/linkedin/daily/snapshot";
import type { LinkedInSendKind, LinkedInSendProvider, LinkedInActionEvidence } from "@/lib/linkedin/send/types";
import {
  HARD_LINKEDIN_CONNECTION_DAILY_CAP,
  HARD_LINKEDIN_MESSAGE_DAILY_CAP,
  type OutreachEnginePolicy,
} from "@/lib/outreach/policy";

export type LinkedInDailyCandidate = RankedLinkedInProspect & Partial<LinkedInProspectCandidate>;

export type LinkedInDailyAttempt = {
  id: string;
  leadId: string;
  kind: LinkedInSendKind;
  ok: boolean;
  sent: boolean;
  consumed: boolean;
  code: string;
  reason: string;
  body?: string;
  provider?: string;
  externalId?: string | null;
  evidence?: LinkedInActionEvidence;
  nextStatus?: "REQUESTED" | null;
};

export type LinkedInDailyRunResult = {
  authorized: boolean;
  canSend: boolean;
  code: string;
  reason: string;
  connectionsSent: number;
  messagesSent: number;
  connectionCap: number;
  messageCap: number;
  qualifiedConnections: number;
  qualifiedMessages: number;
  sent: LinkedInDailyAttempt[];
  skipped: LinkedInDailySkip[];
  errors: string[];
};

export type LinkedInDailyCounters = {
  connectionsSent: number;
  messagesSent: number;
};

export type LinkedInDailyRunInput = {
  policy: OutreachEnginePolicy | null;
  sendProvider: LinkedInSendProvider;
  connections: LinkedInDailyCandidate[];
  messages: LinkedInDailyCandidate[];
  counters: LinkedInDailyCounters;
  attempted?: Set<string>;
  now?: Date;
  composeConnectionNote?: (prospect: RankedLinkedInProspect) => string;
  composeMessage?: (prospect: RankedLinkedInProspect) => string;
};

function connectionCap(policy: OutreachEnginePolicy | null) {
  return Math.min(
    HARD_LINKEDIN_CONNECTION_DAILY_CAP,
    Math.max(0, policy?.linkedinConnectionDailyCap ?? HARD_LINKEDIN_CONNECTION_DAILY_CAP),
  );
}

function messageCap(policy: OutreachEnginePolicy | null) {
  return Math.min(
    HARD_LINKEDIN_MESSAGE_DAILY_CAP,
    Math.max(0, policy?.linkedinMessageDailyCap ?? HARD_LINKEDIN_MESSAGE_DAILY_CAP),
  );
}

export function skipLinkedInDailyCandidate(
  prospect: LinkedInDailyCandidate,
  kind: LinkedInSendKind,
  now = new Date(),
): LinkedInDailySkip | null {
  if (prospect.suppressed || prospect.leadStatus === "DO_NOT_CONTACT") {
    return {
      leadId: prospect.leadId,
      kind,
      code: "DNC",
      reason: "Do-not-contact / suppressed. Stop outreach immediately.",
    };
  }
  if (prospect.auditVerdict === "REJECT") {
    return {
      leadId: prospect.leadId,
      kind,
      code: "REJECTED",
      reason: "Decision Maker REJECT. Stop outreach immediately.",
    };
  }
  if (shouldHaltOutreachForMeeting((prospect.conversationStage as ConversationStage) || "NONE")) {
    return {
      leadId: prospect.leadId,
      kind,
      code: "MEETING_BOOKED",
      reason: "Meeting booked. Stop further LinkedIn outreach for this lead.",
    };
  }
  if (kind === "message" && prospect.connectionStatus !== "CONNECTED") {
    return {
      leadId: prospect.leadId,
      kind,
      code: "NOT_CONNECTED",
      reason: `${prospect.connectionStatus ?? "UNKNOWN"} is not CONNECTED. Do not send a LinkedIn message.`,
    };
  }
  if (kind === "connection" && prospect.connectionStatus === "UNKNOWN") {
    return {
      leadId: prospect.leadId,
      kind,
      code: "UNKNOWN_NOT_SENDABLE",
      reason: "UNKNOWN cannot be treated as CONNECTED and is not a sendable connection state.",
    };
  }
  const eligibility = linkedInProspectEligibility(
    prospect,
    kind === "message" ? "message_send" : "connection_send",
    now,
  );
  if (!eligibility.ok) {
    return {
      leadId: prospect.leadId,
      kind,
      code: eligibility.code,
      reason: eligibility.reason,
    };
  }
  return null;
}

export async function runLinkedInDailyOutreach(input: LinkedInDailyRunInput): Promise<LinkedInDailyRunResult> {
  const now = input.now ?? new Date();
  const day = linkedInLocalDayKey(now);
  const attempted = input.attempted ?? new Set<string>();
  const auth = authorizeLinkedInDailyOutreach({
    policy: input.policy,
    sendProviderConfigured: input.sendProvider.configured,
  });
  const connCap = connectionCap(input.policy);
  const msgCap = messageCap(input.policy);
  const result: LinkedInDailyRunResult = {
    authorized: auth.ok,
    canSend: auth.canSend,
    code: auth.code,
    reason: auth.reason,
    connectionsSent: 0,
    messagesSent: 0,
    connectionCap: connCap,
    messageCap: msgCap,
    qualifiedConnections: input.connections.length,
    qualifiedMessages: input.messages.length,
    sent: [],
    skipped: [],
    errors: auth.ok ? [] : [auth.reason],
  };

  if (!auth.ok || !auth.canSend) {
    return result;
  }

  const connectionNote = input.composeConnectionNote ?? composeLinkedInConnectionNote;
  const messageBody = input.composeMessage ?? composeLinkedInFollowUpMessage;

  const processKind = async (
    kind: LinkedInSendKind,
    prospects: LinkedInDailyCandidate[],
    cap: number,
    compose: (prospect: RankedLinkedInProspect) => string,
  ) => {
    for (const prospect of prospects) {
      const used = kind === "connection" ? input.counters.connectionsSent : input.counters.messagesSent;
      if (used >= cap) break;

      const skip = skipLinkedInDailyCandidate(prospect, kind, now);
      if (skip) {
        result.skipped.push(skip);
        continue;
      }

      const key = linkedInDailyIdempotencyKey({ leadId: prospect.id, kind, day });
      if (attempted.has(key)) {
        result.skipped.push({
          leadId: prospect.leadId,
          kind,
          code: "DUPLICATE",
          reason: "Duplicate LinkedIn action blocked for this lead/day.",
        });
        continue;
      }
      attempted.add(key);

      const body = compose(prospect);
      const sendResult = await input.sendProvider.send({
        leadId: prospect.id,
        profileUrl: prospect.linkedinUrl ?? "",
        kind,
        body,
        idempotencyKey: key,
      });

      if (sendResult.code === "RATE_LIMITED") {
        result.skipped.push({
          id: prospect.id,
          leadId: prospect.leadId,
          kind,
          code: "RATE_LIMITED",
          reason: sendResult.reason,
        });
        result.errors.push(sendResult.reason);
        break;
      }

      if (!sendResult.sent) {
        result.skipped.push({
          id: prospect.id,
          leadId: prospect.leadId,
          kind,
          code: sendResult.code,
          reason: sendResult.reason,
        });
        if (!sendResult.ok) result.errors.push(sendResult.reason);
        continue;
      }

      if (kind === "connection") input.counters.connectionsSent += 1;
      else input.counters.messagesSent += 1;

      const attempt: LinkedInDailyAttempt = {
        id: prospect.id,
        leadId: prospect.leadId,
        kind,
        ok: true,
        sent: true,
        consumed: true,
        code: sendResult.code || "SENT",
        reason: sendResult.reason || "Authorized provider confirmed the send.",
        body,
        provider: sendResult.provider,
        externalId: sendResult.externalId ?? null,
        evidence: sendResult.evidence,
        nextStatus: kind === "connection" ? "REQUESTED" : null,
      };
      result.sent.push(attempt);
      if (kind === "connection") result.connectionsSent += 1;
      else result.messagesSent += 1;
    }
  };

  // Existing CONNECTed outreach first — do not burn the Chrome session only on new invites.
  await processKind("message", input.messages, msgCap, messageBody);
  await processKind("connection", input.connections, connCap, connectionNote);
  return result;
}

let outreachLock: Promise<unknown> = Promise.resolve();

export function withLinkedInDailyLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = outreachLock.then(fn, fn);
  outreachLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

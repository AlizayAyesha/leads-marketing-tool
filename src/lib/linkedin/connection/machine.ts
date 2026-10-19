import { canEnterOutreach } from "@/lib/outreach/gate";
import { HARD_LINKEDIN_CONNECTION_DAILY_CAP, HARD_LINKEDIN_MESSAGE_DAILY_CAP } from "@/lib/outreach/policy";
import { linkedInDailyQuota } from "@/lib/linkedin/connection/quota";
import type {
  ConnectionMachineInput,
  LinkedInConnectionAction,
  LinkedInConnectionStatus,
  TransitionDecision,
} from "@/lib/linkedin/connection/types";

function fail(
  from: LinkedInConnectionStatus,
  code: string,
  reason: string,
): TransitionDecision {
  return { ok: false, from, to: from, code, reason };
}

function ok(from: LinkedInConnectionStatus, to: LinkedInConnectionStatus, code: string, reason: string, extra?: Partial<TransitionDecision>): TransitionDecision {
  return { ok: true, from, to, code, reason, ...extra };
}

function currentStatus(input: ConnectionMachineInput): LinkedInConnectionStatus {
  return input.status ?? "NOT_REQUESTED";
}

function outreachBlocked(input: ConnectionMachineInput, purpose: "draft" | "approve") {
  return canEnterOutreach({
    verdict: input.auditVerdict,
    auditedAt: input.auditedAt,
    suppressed: input.suppressed,
    unsubscribed: input.suppressed,
    leadStatus: input.leadStatus ?? undefined,
    purpose,
  });
}

export function isPostConnectionMessageDue(input: ConnectionMachineInput, now = input.now ?? new Date()) {
  if (currentStatus(input) !== "CONNECTED" || input.stopped) return false;
  const due = input.nextEligibleMessageAt
    ? input.nextEligibleMessageAt instanceof Date
      ? input.nextEligibleMessageAt
      : new Date(input.nextEligibleMessageAt)
    : null;
  // Null = already connected with no wait stamped (legacy / synced network). Eligible for first outreach now.
  if (!due || Number.isNaN(due.getTime())) return true;
  return now.getTime() >= due.getTime();
}

export function decideLinkedInConnectionTransition(
  action: LinkedInConnectionAction,
  input: ConnectionMachineInput,
): TransitionDecision {
  const from = currentStatus(input);
  const now = input.now ?? new Date();

  if (action === "mark_connected") {
    return fail(from, "MARK_CONNECTED_FORBIDDEN", "v1 has no manual mark CONNECTED action. Only an authorized status source may set CONNECTED.");
  }

  if (action === "stop") {
    if (input.stopped) return fail(from, "ALREADY_STOPPED", "LinkedIn connection lifecycle is already stopped.");
    return ok(from, from, "STOPPED", "Reply, unsubscribe, or do-not-contact stops further LinkedIn recommendations.");
  }

  if (input.stopped && action !== "apply_status") {
    return fail(from, "LIFECYCLE_STOPPED", "LinkedIn connection lifecycle is stopped. No further recommendations.");
  }

  if (action === "recommend") {
    if (from !== "NOT_REQUESTED") {
      return fail(from, "ALREADY_IN_PROGRESS", `Connection is already ${from}.`);
    }
    if (input.linkedinDraftsEnabled === false) {
      return fail(from, "CHANNEL_OFF", "LinkedIn drafts are disabled.");
    }
    if (input.linkedinUrlKind !== "person") {
      return fail(from, "NOT_PERSON_URL", "Recommend Connect only for a LinkedIn person profile URL.");
    }
    if (!Array.isArray(input.allowedChannels) || !input.allowedChannels.includes("LINKEDIN")) {
      return fail(from, "CHANNEL_NOT_ALLOWED", "Decision Maker did not allow LinkedIn.");
    }
    const gate = outreachBlocked(input, "draft");
    if (!gate.ok) return fail(from, gate.code, gate.reason);
    const quota = linkedInDailyQuota({
      connectionsToday: input.connectionsToday ?? 0,
      messagesToday: 0,
      connectionCap: input.connectionDailyCap ?? HARD_LINKEDIN_CONNECTION_DAILY_CAP,
      messageCap: HARD_LINKEDIN_MESSAGE_DAILY_CAP,
    });
    if (quota.connectionsRemaining <= 0) {
      return fail(
        from,
        "LINKEDIN_CONNECTION_DAILY_CAP",
        `LinkedIn connection recommendation cap ${quota.connectionCap}/day reached. Rejected recommendations do not count. Jarvis still will not send the invite.`,
      );
    }
    return ok(from, "RECOMMENDED", "RECOMMENDED", "Decision Maker PASS. Recommend a LinkedIn connection. Jarvis will not send it.");
  }

  if (action === "approve") {
    if (from !== "RECOMMENDED") {
      return fail(from, "NOT_RECOMMENDED", "Human approval is only valid after Jarvis recommended a connection.");
    }
    const gate = outreachBlocked(input, "approve");
    if (!gate.ok) return fail(from, gate.code, gate.reason);
    return ok(from, "REQUEST_APPROVED", "REQUEST_APPROVED", "Human approved the connection recommendation. Jarvis still will not send the invite.");
  }

  if (action === "confirm_requested") {
    if (from !== "REQUEST_APPROVED") {
      return fail(from, "NOT_APPROVED", "Operator can confirm REQUESTED only after human approval.");
    }
    return ok(from, "REQUESTED", "REQUESTED", "Operator confirmed they placed the LinkedIn invite. Not CONNECTED.");
  }

  if (action === "apply_status") {
    if (!input.providerConfigured) {
      const to = from === "REQUESTED" || from === "UNKNOWN" ? "UNKNOWN" : from;
      return ok(from, to, "STATUS_UNAVAILABLE", "No authorized connection-status source. UNKNOWN is not CONNECTED.");
    }
    const result = input.providerResult ?? "UNKNOWN";
    if (result === "CONNECTED") {
      if (from === "CONNECTED") {
        const existingDue = input.nextEligibleMessageAt
          ? input.nextEligibleMessageAt instanceof Date
            ? input.nextEligibleMessageAt.toISOString()
            : new Date(input.nextEligibleMessageAt).toISOString()
          : now.toISOString();
        return ok(from, "CONNECTED", "CONNECTED", "Still first-degree. Keep CONNECTED for outreach.", {
          nextEligibleMessageAt: Number.isNaN(Date.parse(existingDue)) ? now.toISOString() : existingDue,
        });
      }
      if (
        from !== "REQUESTED" &&
        from !== "UNKNOWN" &&
        from !== "NOT_REQUESTED" &&
        from !== "RECOMMENDED" &&
        from !== "REQUEST_APPROVED"
      ) {
        return fail(from, "NOT_REQUESTED_YET", "CONNECTED is only allowed after an authorized first-degree check.");
      }
      const waitDays = Math.min(30, Math.max(1, input.waitDays ?? 2));
      // Fresh accepts wait; already-known network (NOT_REQUESTED → CONNECTED via sync) can message now.
      const next =
        from === "NOT_REQUESTED"
          ? now.toISOString()
          : new Date(now.getTime() + waitDays * 24 * 60 * 60 * 1000).toISOString();
      return ok(from, "CONNECTED", "CONNECTED", "Authorized source reported a first-degree connection.", {
        nextEligibleMessageAt: next,
      });
    }
    if (result === "DECLINED") {
      if (from !== "REQUESTED" && from !== "UNKNOWN") {
        return fail(from, "NOT_REQUESTED_YET", "DECLINED is only recorded after a request exists.");
      }
      return ok(from, "DECLINED", "DECLINED", "Authorized source reported the invitation was declined.");
    }
    if (result === "PENDING") {
      if (from === "REQUESTED") {
        return ok(from, "REQUESTED", "PENDING", "Authorized source reports the invitation is still pending. REQUESTED is not CONNECTED.");
      }
      if (from === "NOT_REQUESTED" || from === "RECOMMENDED" || from === "REQUEST_APPROVED") {
        return ok(from, "REQUESTED", "PENDING", "Authorized source shows Pending. Recorded REQUESTED. REQUESTED is not CONNECTED.");
      }
      if (from === "UNKNOWN") {
        return ok(from, "UNKNOWN", "PENDING", "Authorized source did not confirm CONNECTED. UNKNOWN is not CONNECTED.");
      }
    }
    if (from === "REQUESTED") {
      return ok(from, "REQUESTED", "UNKNOWN", "Authorized source did not confirm CONNECTED. Stay REQUESTED. UNKNOWN is not CONNECTED.");
    }
    if (from === "UNKNOWN") {
      return ok(from, "UNKNOWN", "UNKNOWN", "Authorized source did not confirm CONNECTED. Stay UNKNOWN.");
    }
    return fail(from, "STATUS_NOT_APPLICABLE", "Status checks apply after the invite is REQUESTED.");
  }

  if (action === "recommend_message") {
    if (from !== "CONNECTED") {
      return fail(from, "NOT_CONNECTED", "Post-connection messages require an authorized CONNECTED status. UNKNOWN/REQUESTED is not CONNECTED.");
    }
    if (input.linkedinDraftsEnabled === false) {
      return fail(from, "CHANNEL_OFF", "LinkedIn drafts are disabled.");
    }
    const gate = outreachBlocked(input, "draft");
    if (!gate.ok) return fail(from, gate.code, gate.reason);
    if (!isPostConnectionMessageDue(input, now)) {
      return fail(from, "WAIT_PERIOD", "Post-connection wait has not elapsed.");
    }
    if (input.hasPendingMessageDraft) {
      return fail(from, "DRAFT_EXISTS", "A post-connection message draft is already pending.");
    }
    const quota = linkedInDailyQuota({
      connectionsToday: 0,
      messagesToday: input.messagesToday ?? 0,
      connectionCap: HARD_LINKEDIN_CONNECTION_DAILY_CAP,
      messageCap: input.messageDailyCap ?? HARD_LINKEDIN_MESSAGE_DAILY_CAP,
    });
    if (quota.messagesRemaining <= 0) {
      return fail(
        from,
        "LINKEDIN_MESSAGE_DAILY_CAP",
        `LinkedIn message recommendation cap ${quota.messageCap}/day reached. Rejected recommendations do not count. Jarvis still will not send the DM.`,
      );
    }
    return ok(from, "CONNECTED", "MESSAGE_RECOMMENDED", "Wait elapsed. Create a draft-only post-connection message. Jarvis will not send it.");
  }

  if (action === "record_authorized_send") {
    if (from === "REQUESTED") {
      return fail(from, "DUPLICATE", "Connection request already recorded. Do not send again.");
    }
    if (from === "CONNECTED") {
      return fail(from, "ALREADY_CONNECTED", "Already CONNECTED. Do not send another connection request.");
    }
    if (from === "DECLINED") {
      return fail(from, "DECLINED", "Prospect declined. Stop outreach.");
    }
    if (from === "UNKNOWN") {
      return fail(from, "UNKNOWN_NOT_SENDABLE", "UNKNOWN is not a sendable connection state and is not CONNECTED.");
    }
    if (from !== "NOT_REQUESTED" && from !== "RECOMMENDED" && from !== "REQUEST_APPROVED") {
      return fail(from, "ALREADY_IN_PROGRESS", `Connection is already ${from}.`);
    }
    if (input.linkedinUrlKind !== "person") {
      return fail(from, "NOT_PERSON_URL", "Authorized send is only valid for a LinkedIn person profile URL.");
    }
    if (!Array.isArray(input.allowedChannels) || !input.allowedChannels.includes("LINKEDIN")) {
      return fail(from, "CHANNEL_NOT_ALLOWED", "Decision Maker did not allow LinkedIn.");
    }
    const gate = outreachBlocked(input, "approve");
    if (!gate.ok) return fail(from, gate.code, gate.reason);
    return ok(
      from,
      "REQUESTED",
      "REQUESTED",
      "Authorized LinkedIn provider confirmed the connection request. This is not CONNECTED.",
    );
  }

  return fail(from, "UNKNOWN_ACTION", `Unsupported LinkedIn connection action ${action}.`);
}

import type { OutreachChannel } from "@prisma/client";

import type { AuditVerdict } from "@/lib/intelligence/audit";
import { HARD_DAILY_SEND_LIMIT, HARD_MAX_ACTIVE_SEQUENCES, type OutreachEnginePolicy, type OutreachSendMode } from "@/lib/outreach/policy";
import { evaluateCanSend } from "@/lib/intelligence/send-invariant";
import type { TriggerFreshness } from "@/lib/intelligence/evidence";

export const DECISION_FRESH_MS = 14 * 24 * 60 * 60 * 1000;

export const OUTREACH_CLOSED_STATUSES = new Set([
  "DO_NOT_CONTACT",
  "LOST",
  "WON",
  "REPLIED",
  "INTERESTED",
  "MEETING",
  "PROPOSAL",
]);

export const SEQUENCE_REPLY_STOP_REASONS = new Set([
  "REPLY",
  "UNSUBSCRIBE",
  "NOT_INTERESTED",
  "WRONG_PERSON",
  "WANTS_MEETING",
  "INTERESTED",
  "NEEDS_PRICING",
  "WANTS_PORTFOLIO",
  "MAYBE_LATER",
  "OTHER",
]);

export type OutreachPurpose = "draft" | "sequence" | "follow_up" | "approve" | "send";

export type MessagingGateInput = {
  policy: OutreachEnginePolicy;
  sentToday: number;
  activeSequences: number;
  auditVerdict: AuditVerdict | null | unknown;
  auditedAt?: Date | string | null;
  leadStatus: string;
  suppressed: boolean;
  unsubscribed: boolean;
  suppressionUnknown?: boolean;
  policyUnknown?: boolean;
  draftStatus?: string | null;
  channel: OutreachChannel;
  gmailSendConnected: boolean;
  sequenceStatus?: string | null;
  sequenceStopReason?: string | null;
  commandForbidsSend?: boolean;
  alreadyContactedSameChannel?: boolean;
  alreadySentDraft?: boolean;
  testRecipientConfirmed?: boolean;
  testRecipientSend?: boolean;
  /** Home "send email" operator bulk — skips commercial FACT Why Now invariant only. */
  operatorBulkEmail?: boolean;
  quotaBypassAudit?: boolean;
  commercialScore?: number | null;
  commercialPriority?: boolean;
  whyNowType?: string | null;
  whyNowSourceUrl?: string | null;
  whyNowSnippet?: string | null;
  recommendedOffer?: string | null;
  decisionMakerConfidence?: number | null;
  triggerFreshness?: TriggerFreshness | null;
  minimumCommercialScore?: number;
};

export type GateDecision = {
  ok: boolean;
  code: string;
  reason: string;
};

function fail(code: string, reason: string): GateDecision {
  return { ok: false, code, reason };
}

export function parseAuditVerdict(value: unknown): AuditVerdict | null {
  if (value === "PASS" || value === "HOLD" || value === "REJECT") return value;
  return null;
}

export function isFreshAudit(auditedAt?: Date | string | null, now = Date.now()) {
  if (!auditedAt) return false;
  const time = typeof auditedAt === "string" ? Date.parse(auditedAt) : auditedAt.getTime();
  if (!Number.isFinite(time)) return false;
  return now - time <= DECISION_FRESH_MS;
}

/**
 * Authoritative Decision Maker hard gate. Fail closed.
 * Missing, malformed, stale, HOLD, and REJECT are all ineligible.
 */
export function canEnterOutreach(input: {
  verdict: unknown;
  auditedAt?: Date | string | null;
  suppressed?: boolean;
  unsubscribed?: boolean;
  suppressionUnknown?: boolean;
  leadStatus?: string;
  sequenceStopReason?: string | null;
  purpose: OutreachPurpose;
  testRecipientConfirmed?: boolean;
}): GateDecision {
  if (input.suppressionUnknown) {
    return fail("SUPPRESSION_UNKNOWN", "Suppression state could not be determined. Fail closed.");
  }
  if (input.suppressed || input.unsubscribed || input.leadStatus === "DO_NOT_CONTACT") {
    return fail("SUPPRESSED", "Lead is suppressed, unsubscribed, or do-not-contact.");
  }
  if (input.purpose === "sequence" || input.purpose === "follow_up" || input.purpose === "draft" || input.purpose === "approve") {
    if (input.leadStatus && OUTREACH_CLOSED_STATUSES.has(input.leadStatus)) {
      return fail("CONVERSATION_OPEN", `Lead status ${input.leadStatus} must not enter or continue a cold-outreach sequence.`);
    }
    if (input.sequenceStopReason && SEQUENCE_REPLY_STOP_REASONS.has(input.sequenceStopReason)) {
      return fail("SEQUENCE_STOPPED", "A prior reply already stopped this cadence.");
    }
  }
  const verdict = parseAuditVerdict(input.verdict);
  if (!verdict) {
    return fail("DECISION_MISSING", "Decision Maker result is missing or malformed. Outreach is blocked.");
  }
  if (verdict !== "PASS") {
    return fail("DECISION_GATE", `Decision Maker ${verdict}. HOLD/REJECT cannot reach messaging.`);
  }
  if (!isFreshAudit(input.auditedAt)) {
    return fail("DECISION_STALE", "Decision Maker result is missing a timestamp or is older than 14 days. Re-run the audit.");
  }
  return { ok: true, code: "OK", reason: "Decision Maker PASS. Outreach may continue." };
}

export function canEnrollInSequence(input: MessagingGateInput): GateDecision {
  const eligibility = canEnterOutreach({
    verdict: input.auditVerdict,
    auditedAt: input.auditedAt,
    suppressed: input.suppressed,
    unsubscribed: input.unsubscribed,
    suppressionUnknown: input.suppressionUnknown,
    leadStatus: input.leadStatus,
    sequenceStopReason: input.sequenceStopReason,
    purpose: "sequence",
    testRecipientConfirmed: input.testRecipientConfirmed,
  });
  if (!eligibility.ok) return eligibility;
  if (!input.policy.enabled) return fail("ENGINE_OFF", "Outreach engine is off.");
  if (input.leadStatus === "LOST" || input.leadStatus === "WON") {
    return fail("CLOSED", "Lead is already won or lost.");
  }
  if (input.alreadyContactedSameChannel) {
    return fail("DUPLICATE_SEQUENCE", "An active sequence already exists on this channel.");
  }
  if (input.activeSequences >= Math.min(HARD_MAX_ACTIVE_SEQUENCES, input.policy.maxActiveSequences)) {
    return fail("SEQUENCE_CAP", `Active sequence cap is ${Math.min(HARD_MAX_ACTIVE_SEQUENCES, input.policy.maxActiveSequences)}.`);
  }
  if (input.channel === "EMAIL" && !input.policy.emailEnabled) {
    return fail("CHANNEL_OFF", "Email outreach is disabled.");
  }
  if (input.channel === "LINKEDIN") {
    return fail(
      "LINKEDIN_CONNECTION_LIFECYCLE",
      "LinkedIn uses the connection lifecycle, not a cold send sequence. Jarvis still will not send LinkedIn messages.",
    );
  }
  if (input.channel === "INSTAGRAM" && !input.policy.instagramDrafts) {
    return fail("CHANNEL_OFF", "Instagram drafts are disabled.");
  }
  if (input.channel === "X_TWITTER" && !input.policy.twitterDrafts) {
    return fail("CHANNEL_OFF", "X / Twitter drafts are disabled.");
  }
  return { ok: true, code: "OK", reason: "Lead may enroll after a personalized draft." };
}

export function canSendMessage(input: MessagingGateInput): GateDecision {
  if (input.policyUnknown) {
    return fail("POLICY_UNKNOWN", "Outreach policy could not be read. Fail closed — nothing is sent.");
  }
  if (input.alreadySentDraft) {
    return fail("ALREADY_SENT", "This draft was already sent.");
  }
  const eligibility = canEnterOutreach({
    verdict: input.auditVerdict,
    auditedAt: input.auditedAt,
    suppressed: input.suppressed,
    unsubscribed: input.unsubscribed,
    suppressionUnknown: input.suppressionUnknown,
    leadStatus: input.leadStatus,
    sequenceStopReason: input.sequenceStopReason,
    purpose: "send",
    testRecipientConfirmed: input.testRecipientConfirmed,
  });
  if (!eligibility.ok) return eligibility;
  if (!input.policy.enabled) return fail("ENGINE_OFF", "Outreach engine is off.");
  if (input.suppressed || input.unsubscribed || input.leadStatus === "DO_NOT_CONTACT") {
    return fail("SUPPRESSED", "Send blocked: suppressed / unsubscribe / do-not-contact.");
  }
  if (input.sequenceStatus && input.sequenceStatus !== "ACTIVE") {
    return fail("SEQUENCE_STOPPED", "Sequence is not active.");
  }
  if (input.commandForbidsSend) {
    return fail("COMMAND_FORBIDS_SEND", "Operator command forbids sending.");
  }
  if (input.policy.sendsPaused) {
    return fail("KILL_SWITCH", "Sends are paused. Kill switch is on.");
  }
  if (input.policy.sendMode === "draft_only") {
    return fail("DRAFT_ONLY", "Send mode is draft-only. Approve stays in the queue.");
  }
  if (input.draftStatus !== "APPROVED") {
    return fail("NOT_APPROVED", "Draft is not APPROVED.");
  }
  if (input.sentToday >= Math.min(HARD_DAILY_SEND_LIMIT, input.policy.dailySendLimit)) {
    return fail("DAILY_LIMIT", `Daily send limit of ${Math.min(HARD_DAILY_SEND_LIMIT, input.policy.dailySendLimit)} reached.`);
  }
  if (input.channel !== "EMAIL") {
    return fail(
      "SOCIAL_SEND_BLOCKED",
      "LinkedIn, Instagram, and X have no official send adapter here. Use Gmail for email sends; LinkedIn uses Jarvis Chrome Daily. X stays draft-only.",
    );
  }
  if (!input.gmailSendConnected) {
    return fail("GMAIL_NOT_CONNECTED", "Reconnect Google with Gmail send permission to email from Jarvis.");
  }
  const skipQuality = Boolean(
    (input.testRecipientSend && input.testRecipientConfirmed) || input.operatorBulkEmail,
  );
  if (!skipQuality && input.quotaBypassAudit) {
    return fail(
      "QUOTA_BYPASS_AUDIT",
      "Latest audit is an operator quota/wave PASS. Re-run Decision Maker on real evidence — daily cap is a ceiling, not a quota.",
    );
  }
  if (!skipQuality) {
    const invariant = evaluateCanSend({
      killSwitch: input.policy.sendsPaused,
      draftOnly: (input.policy.sendMode as string) === "draft_only",
      humanApproval: input.draftStatus === "APPROVED",
      commercialScore: input.commercialScore,
      commercialPriority: input.commercialPriority,
      whyNowType: input.whyNowType,
      whyNowSourceUrl: input.whyNowSourceUrl,
      whyNowSnippet: input.whyNowSnippet,
      recommendedOffer: input.recommendedOffer,
      decisionMakerConfidence: input.decisionMakerConfidence,
      triggerFreshness: input.triggerFreshness,
    });
    if (!invariant.ok) return invariant;
  }
  return { ok: true, code: "OK", reason: "All send gates passed." };
}

export function sendModeAllowsAutoApprove(mode: OutreachSendMode) {
  return mode === "auto";
}

import { shouldBlockTwitterColdDm } from "@/lib/twitter/daily/eligibility";
import { authorizeTwitterDailyOutreach, twitterDailyIdempotencyKey, twitterLocalDayKey } from "@/lib/twitter/daily/authorize";
import { composeTwitterDm } from "@/lib/twitter/daily/copy";
import type { TwitterDailyCandidate } from "@/lib/twitter/daily/queue";
import type { TwitterActionEvidence, TwitterSendProvider } from "@/lib/twitter/send/types";
import { HARD_TWITTER_DM_DAILY_CAP, type OutreachEnginePolicy } from "@/lib/outreach/policy";
import { isOperatorSheetSource, wantsOurServices } from "@/lib/outreach/wants-services";

export type TwitterDailySkip = {
  leadId: string;
  id?: string;
  code: string;
  reason: string;
  evidence?: TwitterActionEvidence;
};

export type TwitterDailyAttempt = {
  id: string;
  leadId: string;
  ok: boolean;
  sent: boolean;
  consumed: boolean;
  code: string;
  reason: string;
  body?: string;
  provider?: string;
  externalId?: string | null;
  evidence?: TwitterActionEvidence;
};

export type TwitterDailyRunResult = {
  authorized: boolean;
  canSend: boolean;
  code: string;
  reason: string;
  dmsSent: number;
  dmCap: number;
  qualified: number;
  sent: TwitterDailyAttempt[];
  skipped: TwitterDailySkip[];
  errors: string[];
};

function dmCap(policy: OutreachEnginePolicy | null) {
  return Math.min(HARD_TWITTER_DM_DAILY_CAP, Math.max(0, policy?.twitterDmDailyCap ?? HARD_TWITTER_DM_DAILY_CAP));
}

export function skipTwitterDailyCandidate(candidate: TwitterDailyCandidate): TwitterDailySkip | null {
  const gate = shouldBlockTwitterColdDm({
    suppressed: candidate.suppressed,
    leadStatus: candidate.leadStatus,
  });
  if (gate.block) {
    return {
      leadId: candidate.leadId,
      id: candidate.id,
      code: gate.code,
      reason: gate.reason,
    };
  }
  const nominated = isOperatorSheetSource(candidate.source);
  // Discover junk still needs Decision Maker PASS. Sheet/CSV/manual buyers may skip.
  if (!nominated) {
    if (candidate.auditVerdict === "REJECT") {
      return {
        leadId: candidate.leadId,
        id: candidate.id,
        code: "REJECTED",
        reason: "Decision Maker REJECT.",
      };
    }
    if (candidate.auditVerdict !== "PASS") {
      return {
        leadId: candidate.leadId,
        id: candidate.id,
        code: "NOT_PASS",
        reason: "Decision Maker must PASS before an X DM.",
      };
    }
  }
  const wants = wantsOurServices({
    name: candidate.name,
    company: candidate.company,
    location: candidate.location,
    twitterUrl: candidate.twitterUrl,
    roleTitle: candidate.roleTitle ?? candidate.name,
    originalPost: candidate.originalPost,
    notes: candidate.notes,
    source: candidate.source,
    serviceNeedStatus: candidate.serviceNeedStatus,
    opportunitySelection: candidate.opportunitySelection,
    channel: "X_TWITTER",
    nominatedConnection: nominated,
    campaignBrief: candidate.campaignBrief,
  });
  if (!wants.ok) {
    return {
      leadId: candidate.leadId,
      id: candidate.id,
      code: wants.code,
      reason: wants.reason,
    };
  }
  return null;
}

export async function runTwitterDailyOutreach(input: {
  policy: OutreachEnginePolicy | null;
  sendProvider: TwitterSendProvider;
  candidates: TwitterDailyCandidate[];
  dmsSentToday: number;
  attempted?: Set<string>;
  now?: Date;
}): Promise<TwitterDailyRunResult> {
  const now = input.now ?? new Date();
  const day = twitterLocalDayKey(now);
  const cap = dmCap(input.policy);
  const auth = authorizeTwitterDailyOutreach({
    policy: input.policy,
    sendProviderConfigured: input.sendProvider.configured,
  });

  const result: TwitterDailyRunResult = {
    authorized: auth.ok,
    canSend: auth.canSend,
    code: auth.code,
    reason: auth.reason,
    dmsSent: input.dmsSentToday,
    dmCap: cap,
    qualified: input.candidates.length,
    sent: [],
    skipped: [],
    errors: [],
  };

  if (!auth.canSend) return result;

  let sentToday = input.dmsSentToday;
  for (const candidate of input.candidates) {
    if (sentToday >= cap) {
      result.skipped.push({
        leadId: candidate.leadId,
        id: candidate.id,
        code: "DAILY_CAP",
        reason: `X DM daily ceiling of ${cap} reached.`,
      });
      continue;
    }

    const skip = skipTwitterDailyCandidate(candidate);
    if (skip) {
      result.skipped.push(skip);
      continue;
    }

    const key = twitterDailyIdempotencyKey({ leadId: candidate.id, day });
    if (input.attempted?.has(key)) {
      result.skipped.push({
        leadId: candidate.leadId,
        id: candidate.id,
        code: "ALREADY_ATTEMPTED",
        reason: "Already attempted an X DM for this lead today.",
      });
      continue;
    }

    // Prefer short Chat-safe copy. Long email-style drafts break X compose.
    const drafted = candidate.draftMessage?.replace(/\s+/g, " ").trim() ?? "";
    const body =
      drafted && drafted.length <= 240
        ? drafted
        : composeTwitterDm({
            name: candidate.name,
            originalPost: candidate.originalPost,
            company: candidate.company,
          });

    try {
      const sendResult = await input.sendProvider.send({
        leadId: candidate.id,
        profileUrl: candidate.twitterUrl,
        kind: "dm",
        body,
        idempotencyKey: key,
      });
      input.attempted?.add(key);

      if (!sendResult.ok || !sendResult.sent) {
        result.skipped.push({
          leadId: candidate.leadId,
          id: candidate.id,
          code: sendResult.code,
          reason: sendResult.reason,
          evidence: sendResult.evidence,
        });
        if (sendResult.code === "RATE_LIMITED" || sendResult.code === "AUTH_REQUIRED") {
          result.errors.push(sendResult.reason);
          break;
        }
        continue;
      }

      sentToday += 1;
      result.dmsSent = sentToday;
      result.sent.push({
        id: candidate.id,
        leadId: candidate.leadId,
        ok: true,
        sent: true,
        consumed: true,
        code: sendResult.code || "SENT",
        reason: sendResult.reason || "X DM confirmed.",
        body,
        provider: sendResult.provider,
        externalId: sendResult.externalId ?? null,
        evidence: sendResult.evidence,
      });
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      result.skipped.push({
        leadId: candidate.leadId,
        id: candidate.id,
        code: "SESSION_ERROR",
        reason: error instanceof Error ? error.message : "X send failed.",
      });
      break;
    }
  }

  return result;
}

/** Share the LinkedIn daily lock so Chrome isn't raced by both workers. */
export { withLinkedInDailyLock as withTwitterDailyLock } from "@/lib/linkedin/daily/run";

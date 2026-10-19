import { shouldHaltOutreachForMeeting } from "@/lib/conversation/booking";
import type { ConversationStage } from "@/lib/conversation/types";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import { canEnterOutreach } from "@/lib/outreach/gate";
import { isPostConnectionMessageDue } from "@/lib/linkedin/connection/machine";
import { classifyBuyerRole, parseLinkedInCardIdentity } from "@/lib/outreach/buyer-icp";
import { isConnectedPitchSource, isNominatedConnectionSource, wantsOurServices } from "@/lib/outreach/wants-services";
import {
  HARD_LINKEDIN_CONNECTION_DAILY_CAP,
  HARD_LINKEDIN_MESSAGE_DAILY_CAP,
} from "@/lib/outreach/policy";
import type { LinkedInConnectionStatus } from "@/lib/linkedin/connection/types";

export const LINKEDIN_SALES_FUNNEL = [
  "discover",
  "enrich",
  "research",
  "qualify",
  "rank",
  "connection",
  "connected",
  "conversation",
  "meeting",
] as const;

export const LINKEDIN_CONNECTION_ELIGIBILITY_RULE =
  "Verified person + ICP buyer + Decision Maker PASS + mapped your business commercial opportunity + not suppressed/DNC + not already contacted. Authorized discovery sources may identify a prospect; they do not make them eligible. A LinkedIn URL alone is not enough. Daily caps are ceilings, not quotas.";

export const SOURCE_IS_NOT_ELIGIBILITY =
  "Authorized discovery sources may identify prospects. Discovery data does not make the person eligible. Jarvis requires verified identity, ICP fit, Decision Maker qualification, and commercial relevance.";

const INVENTED_PROFILE_RE = /\b(invented|fabricated|guessed)\b/i;

export type LinkedInProspectPurpose = "connection" | "connection_send" | "message" | "message_send";

export const LINKEDIN_SENDABLE_CONNECTION_STATUSES = new Set([
  "NOT_REQUESTED",
  "RECOMMENDED",
  "REQUEST_APPROVED",
]);

export type LinkedInProspectCandidate = {
  id: string;
  leadId: string;
  name?: string | null;
  company?: string | null;
  linkedinUrl?: string | null;
  qualificationScore?: number | null;
  temperature?: string | null;
  auditVerdict?: string | null;
  auditedAt?: Date | string | null;
  allowedChannels?: string[] | null;
  suppressed?: boolean;
  leadStatus?: string | null;
  linkedinUrlKind?: string | null;
  connectionStatus?: LinkedInConnectionStatus | string | null;
  stopped?: boolean;
  rejectedToday?: boolean;
  linkedinResearchStatus?: string | null;
  hasOpportunity?: boolean;
  hasPendingDraft?: boolean;
  nextEligibleMessageAt?: Date | string | null;
  conversationHeat?: string | null;
  conversationStage?: string | null;
  intentScore?: number | null;
  whyNowCount?: number | null;
  source?: string | null;
  roleTitle?: string | null;
  serviceNeedStatus?: string | null;
  opportunitySelection?: string | null;
  originalPost?: string | null;
  notes?: string | null;
  industry?: string | null;
  website?: string | null;
  location?: string | null;
  campaignBrief?: import("@/lib/campaigns/intent").CampaignIntent | null;
};

export type LinkedInProspectEligibility = {
  ok: boolean;
  code: string;
  reason: string;
};

export type RankedLinkedInProspect = {
  id: string;
  leadId: string;
  name: string | null;
  company: string | null;
  linkedinUrl: string | null;
  rank: number;
  rankScore: number;
  qualificationScore: number;
  temperature: string | null;
  connectionStatus: string;
  researchStatus: string | null;
  reasons: string[];
  purpose: LinkedInProspectPurpose;
};

export function linkedInProspectUrlKind(candidate: LinkedInProspectCandidate) {
  return candidate.linkedinUrlKind ?? inspectLinkedInUrl(candidate.linkedinUrl).kind;
}

function prospectBuyerFields(candidate: LinkedInProspectCandidate) {
  const parsed = parseLinkedInCardIdentity(candidate.name);
  const roleTitle =
    candidate.roleTitle?.trim() || parsed.headline || parsed.displayName || candidate.name || null;
  const company = candidate.company?.trim() || parsed.company || null;
  return { parsed, roleTitle, company };
}

function isFilteredOperatorPitch(candidate: LinkedInProspectCandidate, purpose: LinkedInProspectPurpose) {
  if (purpose === "message" || purpose === "message_send") {
    if ((candidate.connectionStatus ?? "NOT_REQUESTED") !== "CONNECTED") return false;
    return isConnectedPitchSource(candidate.source);
  }
  if (purpose === "connection" || purpose === "connection_send") {
    return isNominatedConnectionSource(candidate.source);
  }
  return false;
}

export function linkedInProspectEligibility(
  candidate: LinkedInProspectCandidate,
  purpose: LinkedInProspectPurpose,
  now = new Date(),
): LinkedInProspectEligibility {
  if (candidate.rejectedToday) {
    return { ok: false, code: "REJECTED_TODAY", reason: "Rejected today. That slot was freed for a different prospect." };
  }
  if (candidate.stopped) {
    return { ok: false, code: "LIFECYCLE_STOPPED", reason: "LinkedIn connection lifecycle is stopped." };
  }
  if (shouldHaltOutreachForMeeting((candidate.conversationStage as ConversationStage) || "NONE")) {
    return { ok: false, code: "MEETING_BOOKED", reason: "Meeting booked. Stop further outreach for this lead." };
  }
  const sheetPitch = isFilteredOperatorPitch(candidate, purpose);
  if (!sheetPitch) {
    const gate = canEnterOutreach({
      verdict: candidate.auditVerdict,
      auditedAt: candidate.auditedAt,
      suppressed: candidate.suppressed,
      unsubscribed: candidate.suppressed,
      leadStatus: candidate.leadStatus ?? undefined,
      purpose: "draft",
    });
    if (!gate.ok) return { ok: false, code: gate.code, reason: gate.reason };
    if (!Array.isArray(candidate.allowedChannels) || !candidate.allowedChannels.includes("LINKEDIN")) {
      return { ok: false, code: "CHANNEL_NOT_ALLOWED", reason: "Decision Maker did not allow LinkedIn." };
    }
  } else if (candidate.suppressed || candidate.leadStatus === "DO_NOT_CONTACT") {
    return { ok: false, code: "SUPPRESSED", reason: "Lead is suppressed, unsubscribed, or do-not-contact." };
  }
  if (linkedInProspectUrlKind(candidate) !== "person") {
    return { ok: false, code: "NOT_PERSON_URL", reason: "Queue only person LinkedIn profile URLs, not company pages or missing URLs." };
  }
  const fields = prospectBuyerFields(candidate);
  const buyer = classifyBuyerRole(fields.roleTitle, fields.company);
  if (!buyer.ok) {
    // Nominated sheet/buyer-list people: allow when not agency/tech/HR.
    // Company helps, but a verified person name + person URL is enough —
    // LinkedIn search rows often have no company column filled.
    const sheetNonTech =
      sheetPitch &&
      buyer.code !== "AGENCY_HOLDER" &&
      buyer.code !== "TECH_PEER_COMPANY" &&
      buyer.code !== "PEER_BUILDER_OR_DESIGNER" &&
      buyer.code !== "HR_OR_RECRUITER" &&
      (Boolean(fields.company?.trim()) || Boolean(candidate.name?.trim()));
    if (!sheetNonTech) {
      return { ok: false, code: "ICP_MISMATCH", reason: buyer.reason };
    }
  }
  const wants = wantsOurServices({
    name: candidate.name,
    company: fields.company,
    industry: candidate.industry,
    website: candidate.website,
    location: candidate.location,
    linkedinUrl: candidate.linkedinUrl,
    roleTitle: fields.roleTitle,
    originalPost: candidate.originalPost,
    notes: candidate.notes,
    source: candidate.source,
    serviceNeedStatus: candidate.serviceNeedStatus,
    opportunitySelection: candidate.opportunitySelection,
    channel: "LINKEDIN",
    connectedMessage: purpose === "message" || purpose === "message_send",
    nominatedConnection: purpose === "connection" || purpose === "connection_send",
    campaignBrief: candidate.campaignBrief,
  });
  if (!wants.ok) {
    return { ok: false, code: wants.code, reason: wants.reason };
  }

  const status = candidate.connectionStatus ?? "NOT_REQUESTED";
  if (purpose === "connection" || purpose === "connection_send") {
    if (INVENTED_PROFILE_RE.test(candidate.source ?? "")) {
      return { ok: false, code: "INVENTED_PROFILE", reason: "Invented or guessed profiles are not connection prospects." };
    }
    if (purpose === "connection") {
      if (status !== "NOT_REQUESTED") {
        return { ok: false, code: "ALREADY_IN_PROGRESS", reason: `Connection is already ${status}.` };
      }
      if (candidate.hasPendingDraft) {
        return { ok: false, code: "DRAFT_EXISTS", reason: "A connection recommendation is already pending approval." };
      }
    } else if (!LINKEDIN_SENDABLE_CONNECTION_STATUSES.has(status)) {
      return {
        ok: false,
        code: "ALREADY_IN_PROGRESS",
        reason: `Connection is already ${status}. Daily send only acts on NOT_REQUESTED, RECOMMENDED, or REQUEST_APPROVED.`,
      };
    }
    if (!isNominatedConnectionSource(candidate.source)) {
      const commercial = connectionCommercialEligibility(candidate);
      if (!commercial.ok) return commercial;
    } else if (!candidate.name?.trim()) {
      return { ok: false, code: "PERSON_UNVERIFIED", reason: "No verified person name. A LinkedIn URL is not enough." };
    }
    return {
      ok: true,
      code: "OK",
      reason:
        purpose === "connection_send"
          ? "Eligible for an authorized LinkedIn connection send."
          : "Eligible for a LinkedIn connection.",
    };
  }

  if (status === "REQUESTED" || status === "UNKNOWN") {
    return {
      ok: false,
      code: "NOT_CONNECTED",
      reason: `${status} is not CONNECTED. Jarvis will not message until an authorized status source reports CONNECTED.`,
    };
  }
  if (status !== "CONNECTED") {
    return { ok: false, code: "NOT_CONNECTED", reason: "Post-connection messages require an authorized CONNECTED status." };
  }

  // Live operator send to existing connections — do not wait on draft approval or wait timer.
  if (purpose === "message_send") {
    return {
      ok: true,
      code: "OK",
      reason: "Eligible for a live LinkedIn message to an existing connection.",
    };
  }

  if (candidate.hasPendingDraft) {
    return { ok: false, code: "DRAFT_EXISTS", reason: "A post-connection message draft is already pending." };
  }
  if (
    !isPostConnectionMessageDue(
      {
        status: "CONNECTED",
        stopped: false,
        nextEligibleMessageAt: candidate.nextEligibleMessageAt ?? null,
        now,
      },
      now,
    )
  ) {
    return { ok: false, code: "WAIT_PERIOD", reason: "Post-connection wait has not elapsed." };
  }
  return { ok: true, code: "OK", reason: "Eligible for a post-connection LinkedIn message." };
}

export function connectionCommercialEligibility(candidate: LinkedInProspectCandidate): LinkedInProspectEligibility {
  if (!candidate.name?.trim()) {
    return { ok: false, code: "PERSON_UNVERIFIED", reason: "No verified person name. A LinkedIn URL is not enough." };
  }
  if (candidate.linkedinResearchStatus !== "AVAILABLE") {
    return {
      ok: false,
      code: "PERSON_UNVERIFIED",
      reason: "Person is not research-verified yet. Discover → enrich → research before recommending a connection.",
    };
  }
  const buyer = classifyBuyerRole(candidate.roleTitle, candidate.company);
  if (!buyer.ok) {
    return { ok: false, code: "ICP_MISMATCH", reason: buyer.reason };
  }
  if (!candidate.hasOpportunity) {
    return {
      ok: false,
      code: "NO_COMMERCIAL_RELEVANCE",
      reason: "No mapped your business commercial opportunity. A discovered profile is not a buyer.",
    };
  }
  return { ok: true, code: "OK", reason: "Commercially relevant, verified person." };
}

export function computeLinkedInRankScore(candidate: LinkedInProspectCandidate) {
  const qualificationScore = Math.max(0, Number(candidate.qualificationScore) || 0);
  const reasons: string[] = [`Qualification score ${qualificationScore}`];
  let rankScore = qualificationScore;
  const heat = candidate.conversationHeat;
  if (heat === "MEETING" || heat === "HOT") {
    rankScore += 20;
    reasons.push(`Conversation ${heat}`);
  } else if (heat === "QUALIFIED") {
    rankScore += 16;
    reasons.push("Conversation QUALIFIED");
  } else if (heat === "PROBLEM") {
    rankScore += 10;
    reasons.push("Conversation PROBLEM");
  } else if (heat === "ENGAGED") {
    rankScore += 8;
    reasons.push("Conversation ENGAGED");
  } else if (candidate.temperature === "HOT") {
    rankScore += 15;
    reasons.push("Research HOT");
  } else if (candidate.temperature === "WARM") {
    rankScore += 8;
    reasons.push("Research WARM");
  }
  const intentScore = Math.max(0, Math.min(5, Number(candidate.intentScore) || 0));
  if (intentScore) {
    rankScore += intentScore * 4;
    reasons.push(`Buying intent ${intentScore}`);
  }
  const whyNow = Math.max(0, Number(candidate.whyNowCount) || 0);
  if (whyNow) {
    rankScore += whyNow * 5;
    reasons.push(`Why-now ${whyNow}`);
  }
  if (candidate.linkedinResearchStatus === "AVAILABLE") {
    rankScore += 10;
    reasons.push("LinkedIn research available");
  }
  if (candidate.hasOpportunity) {
    rankScore += 8;
    reasons.push("Opportunity mapped");
  }
  if (isNominatedConnectionSource(candidate.source) || isConnectedPitchSource(candidate.source)) {
    rankScore += 25;
    reasons.push("Operator-nominated buyer");
  }
  return { rankScore, qualificationScore, reasons };
}

export function rankLinkedInProspects(
  candidates: LinkedInProspectCandidate[],
  input: {
    purpose: LinkedInProspectPurpose;
    limit?: number;
    now?: Date;
  },
): RankedLinkedInProspect[] {
  const hard = input.purpose === "message" ? HARD_LINKEDIN_MESSAGE_DAILY_CAP : HARD_LINKEDIN_CONNECTION_DAILY_CAP;
  const limit = Math.min(hard, Math.max(0, input.limit ?? hard));
  const now = input.now ?? new Date();
  const purpose = input.purpose === "connection_send" ? "connection_send" : input.purpose;
  const eligible = candidates
    .filter((candidate) => linkedInProspectEligibility(candidate, purpose, now).ok)
    .map((candidate) => {
      const scored = computeLinkedInRankScore(candidate);
      return {
        id: candidate.id,
        leadId: candidate.leadId,
        name: candidate.name ?? null,
        company: candidate.company ?? null,
        linkedinUrl: candidate.linkedinUrl ?? null,
        rank: 0,
        rankScore: scored.rankScore,
        qualificationScore: scored.qualificationScore,
        temperature: candidate.temperature ?? null,
        connectionStatus: candidate.connectionStatus ?? "NOT_REQUESTED",
        researchStatus: candidate.linkedinResearchStatus ?? null,
        reasons: scored.reasons,
        purpose,
      } satisfies RankedLinkedInProspect;
    })
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      if (b.qualificationScore !== a.qualificationScore) return b.qualificationScore - a.qualificationScore;
      return a.leadId.localeCompare(b.leadId);
    })
    // Ceiling, not quota: return fewer than `limit` when fewer prospects qualify.
    .slice(0, limit);
  return eligible.map((item, index) => ({ ...item, rank: index + 1 }));
}

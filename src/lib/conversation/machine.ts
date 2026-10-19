import { shouldSendMeetingLink } from "@/lib/conversation/booking";
import { behaviorForIntent } from "@/lib/conversation/intent";
import {
  STAGE_RANK,
  normalizeConversationStage,
  type BuyingIntentScore,
  type ConversationAnalysis,
  type ConversationDecision,
  type ConversationHeat,
  type ConversationStage,
} from "@/lib/conversation/types";

export function decideConversationTransition(input: {
  from: ConversationStage | null;
  analysis: ConversationAnalysis;
  connected: boolean;
  hasBookingUrl?: boolean;
  channel?: "EMAIL" | "LINKEDIN" | "INSTAGRAM" | "FACEBOOK" | "X_TWITTER";
}): ConversationDecision {
  const normalized = normalizeConversationStage(input.from);
  const from: ConversationStage =
    normalized && normalized !== "NONE" ? normalized : input.connected ? "CONNECTED" : "NONE";
  const score = input.analysis.intentScore;
  const heat = input.analysis.heat;

  if (input.analysis.cue === "no_reply") {
    return pack(from, from, "WAIT", "No reply. Wait. Do not pitch a silent connection.", false, false, true, score, heat);
  }
  if (input.analysis.cue === "dnc") {
    return pack(from, "STOPPED", "DNC", "They asked not to be contacted. Relationship stops immediately.", false, true, false, 0, "COLD");
  }
  if (input.analysis.cue === "decline") {
    return pack(from, "STOPPED", "DECLINED", "They said no. Stop. Do not keep selling.", false, true, false, 0, "COLD");
  }
  if (from === "STOPPED") {
    return pack(from, "STOPPED", "ALREADY_STOPPED", "Conversation already stopped.", false, true, false, 0, "COLD");
  }
  if (!input.connected && from === "NONE") {
    return pack(
      from,
      "NONE",
      "NOT_CONNECTED",
      "REQUESTED is not CONNECTED. No conversation until an authorized source confirms CONNECTED.",
      false,
      false,
      true,
      0,
      "COLD",
    );
  }

  const linkedIn = (input.channel ?? "LINKEDIN") === "LINKEDIN";
  const canSendLink = linkedIn || Boolean(input.hasBookingUrl);
  const to = nextStage(from, input.analysis, canSendLink);
  const pitchAllowed = score >= 3;
  return {
    from,
    to,
    code: to === from ? "CONTINUE" : `ADVANCE_${to}`,
    reason: input.analysis.summary,
    pitchAllowed,
    stopRelationship: false,
    wait: false,
    intentScore: score,
    heat,
  };
}

function nextStage(from: ConversationStage, analysis: ConversationAnalysis, canSendLink: boolean): ConversationStage {
  const start = from === "CONNECTED" ? "GETTING_TO_KNOW" : from;
  if (analysis.cue === "booked") return "MEETING_BOOKED";
  if (analysis.cue === "booking_started") return "BOOKING_STARTED";

  const sendLink = shouldSendMeetingLink({
    from: start,
    cue: analysis.cue,
    text: analysis.text ?? "",
  });
  let proposed: ConversationStage = start;
  if (sendLink) proposed = canSendLink ? "LINK_SENT" : "MEETING_PROPOSED";
  else {
    const mode = behaviorForIntent(analysis.intentScore);
    if (mode === "meeting_push") proposed = analysis.cue === "asked_what_you_do" ? "PITCH" : "INTEREST";
    else if (mode === "position") proposed = "PITCH";
    else if (mode === "qualify") proposed = "PROBLEM_IDENTIFIED";
    else if (analysis.cue === "maybe_later" || analysis.cue === "interested" || analysis.cue === "casual") {
      proposed = start;
    } else if (mode === "natural" && analysis.match.strength === "weak") proposed = "DISCOVERY";
    else if (mode === "natural" && analysis.cue === "problem") proposed = start;
  }

  return stayInsideGuardrail(start, proposed, analysis);
}

function stayInsideGuardrail(from: ConversationStage, proposed: ConversationStage, analysis: ConversationAnalysis): ConversationStage {
  if (proposed === "STOPPED" || proposed === "MEETING_BOOKED" || proposed === "BOOKING_STARTED" || proposed === "COMPLETED") {
    return proposed;
  }
  if (STAGE_RANK[proposed] < STAGE_RANK[from]) {
    if (analysis.match.matched && (analysis.match.buyingSignal || analysis.intentScore >= 3)) return "INTEREST";
    return from;
  }
  if (proposed === "PITCH" && STAGE_RANK[from] >= STAGE_RANK.PITCH && analysis.match.matched) {
    return "INTEREST";
  }
  return proposed;
}

function pack(
  from: ConversationStage,
  to: ConversationStage,
  code: string,
  reason: string,
  pitchAllowed: boolean,
  stopRelationship: boolean,
  wait: boolean,
  intentScore: BuyingIntentScore,
  heat: ConversationHeat,
): ConversationDecision {
  return { from, to, code, reason, pitchAllowed, stopRelationship, wait, intentScore, heat };
}

export function openingConversationStage(): ConversationDecision {
  return {
    from: "CONNECTED",
    to: "GETTING_TO_KNOW",
    code: "OPENING_DRAFT",
    reason: "Authorized CONNECTED plus wait elapsed. Natural opener only. Do not pitch a new connection.",
    pitchAllowed: false,
    stopRelationship: false,
    wait: false,
    intentScore: 0,
    heat: "COLD",
  };
}

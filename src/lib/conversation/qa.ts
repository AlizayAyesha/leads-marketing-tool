import type { ConversationCue, ConversationStage } from "@/lib/conversation/types";

export const OPERATOR_DRAFT_QA = {
  question: "If I were the prospect, does this message make me more likely to hire your business?",
  keep: "Yes → keep it.",
  reject: [
    "It teaches them how to do the work themselves → reject.",
    "It invents a problem they did not state → reject.",
    "It asks unnecessary questions → reject.",
    "They are already interested and it keeps chatting instead of converting → reject.",
  ],
  afterBooking: "STOP. No follow-up sequence, no extra pitch, no “just checking in.” The meeting is the conversion event.",
} as const;

const CONSULTING_LEAK_RE =
  /\b(you should|you could use|implement lead scoring|webhooks|qualification agent|here are \d|step 1|7 ways|core web vitals|implementation plan|step[- ]by[- ]step|\bn8n\b|\bzapier\b|\bmake\.com\b|use hubspot|keyword research|```|function\s+\w+\()\b/i;
const INVENTED_PAIN_RE =
  /\b(i noticed you('re| are) struggling|your operations are becoming|that bottleneck|i can see you're (struggling|overwhelmed))\b/i;
const UNNECESSARY_QUESTION_RE =
  /\b(what'?s your (current )?crm|how many leads|what'?s taking most of your time|biggest headache|where does (the )?process break|what tech(nology| stack)? are you using)\b/i;
const CHECKING_IN_RE = /\b(just checking in|circling back|bumping this|following up on my last|any update on this)\b/i;
const FREE_TEACHING_RE =
  /\b(here'?s how you can|you can do this yourself|try this (approach|stack)|step[- ]by[- ]step|n8n|zapier|hubspot workflow)\b/i;

export function reviewCommercialDraft(input: {
  message: string;
  stage?: ConversationStage | null;
  cue?: ConversationCue | null;
}): { keep: boolean; reason: string } {
  const message = input.message.trim();
  if (!message) return { keep: true, reason: "No draft to send." };

  if (input.stage === "MEETING_BOOKED" || input.stage === "BOOKED" || input.stage === "COMPLETED") {
    if (CHECKING_IN_RE.test(message) || /\/go\/linkedin|want to have a quick call|our services include/i.test(message)) {
      return { keep: false, reason: "Meeting already booked. Stop selling." };
    }
    return { keep: true, reason: "Courtesy confirmation only. Outreach stops." };
  }

  if (CONSULTING_LEAK_RE.test(message) || FREE_TEACHING_RE.test(message)) {
    return { keep: false, reason: "It teaches them how to do the work themselves." };
  }
  if (INVENTED_PAIN_RE.test(message)) {
    return { keep: false, reason: "It invents a problem they did not state." };
  }
  if (
    (input.stage === "PITCH" ||
      input.stage === "INTEREST" ||
      input.stage === "LINK_SENT" ||
      input.cue === "asked_for_help" ||
      input.cue === "meeting" ||
      input.cue === "interested") &&
    UNNECESSARY_QUESTION_RE.test(message)
  ) {
    return { keep: false, reason: "It asks unnecessary questions instead of converting." };
  }
  if (
    (input.cue === "meeting" || input.cue === "asked_for_help") &&
    input.stage !== "LINK_SENT" &&
    input.stage !== "MEETING_PROPOSED" &&
    input.stage !== "MEETING"
  ) {
    return { keep: false, reason: "They are already interested and it keeps chatting instead of converting." };
  }

  return { keep: true, reason: OPERATOR_DRAFT_QA.question };
}

export function assertCommercialDraft(input: {
  message: string;
  stage?: ConversationStage | null;
  cue?: ConversationCue | null;
}) {
  const review = reviewCommercialDraft(input);
  if (!review.keep) {
    throw new Error(`Commercial QA reject: ${review.reason}`);
  }
}

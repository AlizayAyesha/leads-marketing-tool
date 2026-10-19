import { type BuyingIntentScore, type ConversationCue, type ConversationMatch, type WhyNowSignals } from "@/lib/conversation/types";

export function scoreBuyingIntent(input: {
  cue: ConversationCue;
  match: ConversationMatch;
  whyNow: WhyNowSignals;
  text: string;
}): { score: BuyingIntentScore; reason: string } {
  const { cue, match } = input;
  if (cue === "no_reply" || cue === "dnc" || cue === "decline") {
    return { score: 0, reason: "No commercial intent." };
  }
  if (cue === "booked" || cue === "booking_started" || cue === "meeting") {
    return { score: 5, reason: "They want to talk or already booked." };
  }
  if (cue === "asked_for_help") {
    return { score: 5, reason: "They asked for help or the deliverable. Do not give it away. Convert to a meeting." };
  }
  if (cue === "buying_intent") {
    return { score: 4, reason: "They asked about your business, pricing, or next-step commercial detail." };
  }
  if (cue === "asked_what_you_do") {
    return { score: 4, reason: "They asked what your business does. Position commercially. Do not restart discovery." };
  }
  if (cue === "maybe_later") {
    return { score: 1, reason: "Soft interest, no urgency." };
  }
  if (cue === "interested") {
    if (/\bsend me\b/i.test(input.text) || /\btell me more\b/i.test(input.text)) {
      return { score: 4, reason: "They asked what your business does commercially. Explain and convert. Do not manufacture pain." };
    }
    if (/\b(exactly what we need|that could help|this is relevant|sounds good)\b/i.test(input.text) && /need|help|relevant/.test(input.text)) {
      return { score: 4, reason: "They confirmed the problem is relevant. Push toward a meeting." };
    }
    return match.matched || match.buyingSignal
      ? { score: 4, reason: "Interest after a real problem. Push toward a meeting." }
      : { score: 1, reason: "Engaged, but no qualified problem yet." };
  }

  if (match.matched) {
    return { score: 3, reason: "A offer-relevant problem is on the table. Stop interviewing and sell." };
  }
  if (cue === "problem" || match.strength === "weak") {
    return { score: 1, reason: "Vague or unmatched. One qualifying question only if it could be a real opportunity." };
  }
  return { score: 0, reason: "Casual conversation." };
}

export function behaviorForIntent(score: BuyingIntentScore) {
  if (score <= 1) return "natural";
  if (score === 2) return "qualify";
  if (score === 3) return "position";
  if (score === 4) return "meeting_push";
  return "book";
}

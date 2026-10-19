import type { BuyingIntentScore, ConversationCue, ConversationHeat } from "@/lib/conversation/types";

export function conversationHeatFrom(input: {
  score: BuyingIntentScore;
  cue: ConversationCue;
}): ConversationHeat {
  if (input.cue === "dnc" || input.cue === "decline" || input.cue === "no_reply") return "COLD";
  if (input.score >= 5) return "MEETING";
  if (input.score === 4) return "HOT";
  if (input.score === 3) return "QUALIFIED";
  if (input.score === 2) return "PROBLEM";
  if (input.score === 1 || input.cue === "interested" || input.cue === "maybe_later") return "ENGAGED";
  return "COLD";
}

export function leadTemperatureFromHeat(heat: ConversationHeat): "HOT" | "WARM" | "COLD" {
  if (heat === "HOT" || heat === "MEETING" || heat === "QUALIFIED") return "HOT";
  if (heat === "ENGAGED" || heat === "PROBLEM") return "WARM";
  return "COLD";
}

const RANK: Record<string, number> = { COLD: 0, WARM: 1, HOT: 2, DISQUALIFIED: -1 };

export function raiseLeadTemperature(
  current: string | null | undefined,
  heat: ConversationHeat,
): "HOT" | "WARM" | "COLD" | null {
  if (current === "DISQUALIFIED") return null;
  const next = leadTemperatureFromHeat(heat);
  if (!current) return next;
  return RANK[next] > (RANK[current] ?? 0) ? next : null;
}

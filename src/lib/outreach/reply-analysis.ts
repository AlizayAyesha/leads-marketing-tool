import { classifyReply, suggestedReply, type ReplyClassification, type ReplyIntent } from "@/lib/outreach/replies";
import { ENGAGEMENT_NOT_AVAILABLE } from "@/lib/outreach/lifecycle-events";

export type ReplyAnalysis = ReplyClassification & {
  needsHumanDraft: boolean;
  draftSuggestion: { subject: string; message: string };
  openTracking: typeof ENGAGEMENT_NOT_AVAILABLE;
  clickTracking: typeof ENGAGEMENT_NOT_AVAILABLE;
};

export function analyzeReply(
  text: string,
  context?: { name?: string | null; channel?: string | null },
): ReplyAnalysis {
  const classification = classifyReply(text);
  return {
    ...classification,
    needsHumanDraft: classification.escalate,
    draftSuggestion: suggestedReply({
      intent: classification.intent,
      name: context?.name,
      channel: context?.channel,
    }),
    openTracking: ENGAGEMENT_NOT_AVAILABLE,
    clickTracking: ENGAGEMENT_NOT_AVAILABLE,
  };
}

export function isPositiveIntent(intent: ReplyIntent) {
  return (
    intent === "INTERESTED" ||
    intent === "NEEDS_PRICING" ||
    intent === "WANTS_PORTFOLIO" ||
    intent === "WANTS_MEETING" ||
    intent === "ASKS_EMAIL"
  );
}

import { z } from "zod";

import { outreachChannelSchema } from "./common";

export const outcomeStatusSchema = z.enum([
  "none",
  "sent",
  "delivered",
  "replied",
  "interested",
  "meeting",
  "pricing",
  "not_interested",
  "wrong_person",
  "unsubscribe",
  "bounced",
  "no_response",
  "sequence_stopped",
]);

export const evaluationKindSchema = z.enum([
  "positive",
  "neutral",
  "negative",
  "bad_decision",
  "safety",
]);

export const outcomeContractSchema = z.object({
  leadId: z.string().min(1),
  channel: outreachChannelSchema.nullable(),
  sent: z.boolean(),
  delivered: z.boolean().nullable(),
  replied: z.boolean(),
  interested: z.boolean(),
  meeting: z.boolean(),
  pricing: z.boolean(),
  notInterested: z.boolean(),
  wrongPerson: z.boolean(),
  unsubscribe: z.boolean(),
  bounced: z.boolean(),
  noResponse: z.boolean(),
  sequenceStopped: z.boolean(),
  status: outcomeStatusSchema,
  replyIntent: z.string().nullable(),
});

export type OutcomeContract = z.infer<typeof outcomeContractSchema>;
export type EvaluationKind = z.infer<typeof evaluationKindSchema>;

export function parseOutcomeContract(input: unknown) {
  return outcomeContractSchema.safeParse(input);
}

export function classifyEvaluation(input: {
  verdict?: string | null;
  outcome: Pick<
    OutcomeContract,
    "sent" | "replied" | "interested" | "meeting" | "notInterested" | "wrongPerson" | "unsubscribe"
  >;
}): EvaluationKind | null {
  if (input.verdict === "HOLD" || input.verdict === "REJECT") return "safety";
  if (input.outcome.wrongPerson) return "bad_decision";
  if (input.outcome.notInterested || input.outcome.unsubscribe) return "negative";
  if (input.outcome.sent && input.outcome.replied && (input.outcome.interested || input.outcome.meeting)) {
    return "positive";
  }
  if (input.outcome.sent && !input.outcome.replied) return "neutral";
  return null;
}

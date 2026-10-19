export const LOST_REASONS = [
  "wrong_person",
  "wrong_offer",
  "bad_timing",
  "no_budget",
  "not_interested",
  "competitor",
  "already_has_solution",
  "no_response",
  "invalid_contact",
  "poor_personalization",
  "pricing",
  "unknown",
] as const;

export type LostReason = (typeof LOST_REASONS)[number];

export function asLostReason(value: string | null | undefined): LostReason | null {
  if (!value) return null;
  return (LOST_REASONS as readonly string[]).includes(value) ? (value as LostReason) : null;
}

export function lostReasonFromOutcome(input: {
  wrongPerson?: boolean;
  notInterested?: boolean;
  noResponse?: boolean;
  pricing?: boolean;
  replyIntent?: string | null;
}): LostReason | null {
  const fromIntent = asLostReason(input.replyIntent);
  if (fromIntent) return fromIntent;
  if (input.wrongPerson) return "wrong_person";
  if (input.pricing) return "pricing";
  if (input.notInterested) return "not_interested";
  if (input.noResponse) return "no_response";
  return null;
}

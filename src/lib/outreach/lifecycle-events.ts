/** Outreach lifecycle event catalog. Opens/clicks are never invented. */

export const LIFECYCLE_EVENT = {
  DISCOVERED: "DISCOVERED",
  RESEARCHED: "RESEARCHED",
  QUALIFIED: "QUALIFIED",
  HELD: "HELD",
  REJECTED: "REJECTED",
  DRAFTED: "DRAFTED",
  APPROVED: "APPROVED",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  OPEN: "OPEN",
  CLICK: "CLICK",
  REPLIED: "REPLIED",
  POSITIVE_REPLY: "POSITIVE_REPLY",
  MEETING: "MEETING",
  UNSUBSCRIBE: "UNSUBSCRIBE",
  BOUNCE: "BOUNCE",
  NO_RESPONSE: "NO_RESPONSE",
} as const;

export type LifecycleEventType = (typeof LIFECYCLE_EVENT)[keyof typeof LIFECYCLE_EVENT];

export const ENGAGEMENT_NOT_AVAILABLE = "NOT_AVAILABLE" as const;

export function openClickStatus(observed: boolean): "OBSERVED" | typeof ENGAGEMENT_NOT_AVAILABLE {
  return observed ? "OBSERVED" : ENGAGEMENT_NOT_AVAILABLE;
}

/** No-response is only valid after the sequence finished without a reply. */
export function canRecordNoResponse(input: { sequenceCompleted: boolean; alreadyReplied: boolean }) {
  return input.sequenceCompleted && !input.alreadyReplied;
}

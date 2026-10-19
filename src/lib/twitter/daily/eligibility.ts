/** Who may receive a cold X DM. One outbound DM is enough until a human reopens. */

export const TWITTER_COLD_DM_CLOSED_STATUSES = [
  "DO_NOT_CONTACT",
  "LOST",
  "WON",
  "CONTACTED",
  "REPLIED",
  "INTERESTED",
  "MEETING",
  "PROPOSAL",
] as const;

export function isTwitterColdDmClosedStatus(status: string | null | undefined): boolean {
  return TWITTER_COLD_DM_CLOSED_STATUSES.includes(
    String(status ?? "").trim().toUpperCase() as (typeof TWITTER_COLD_DM_CLOSED_STATUSES)[number],
  );
}

/** True when this lead must never get another automated cold X DM. */
export function shouldBlockTwitterColdDm(input: {
  suppressed?: boolean;
  leadStatus?: string | null;
  alreadyDmSent?: boolean;
  negativeReply?: boolean;
}): { block: boolean; code: string; reason: string } {
  if (input.suppressed) {
    return { block: true, code: "DNC", reason: "Suppressed / do-not-contact. Never DM again." };
  }
  if (String(input.leadStatus ?? "").toUpperCase() === "DO_NOT_CONTACT") {
    return { block: true, code: "DNC", reason: "Do-not-contact. Never DM again." };
  }
  if (input.negativeReply) {
    return { block: true, code: "SAID_NO", reason: "They declined on X. Never DM again." };
  }
  if (input.alreadyDmSent) {
    return {
      block: true,
      code: "ALREADY_DMED",
      reason: "Already sent an X DM. No reply / no reopen — do not message again.",
    };
  }
  if (isTwitterColdDmClosedStatus(input.leadStatus)) {
    return {
      block: true,
      code: "ALREADY_TOUCHED",
      reason: `Lead status ${input.leadStatus} is closed for cold X DMs.`,
    };
  }
  return { block: false, code: "OK", reason: "Eligible for one cold X DM." };
}

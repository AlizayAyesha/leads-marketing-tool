import { DEFAULT_MIN_COMMERCIAL_SCORE } from "@/lib/outreach/quality";

export const DM_CONFIDENCE_SEND_THRESHOLD = 70;

export type TriggerFreshness = "fresh" | "aging" | "stale" | "unknown";

export type CanSendInvariantInput = {
  killSwitch: boolean;
  draftOnly: boolean;
  humanApproval: boolean;
  commercialScore: number | null | undefined;
  commercialPriority: boolean | undefined;
  whyNowType: string | null | undefined;
  whyNowSourceUrl: string | null | undefined;
  whyNowSnippet: string | null | undefined;
  recommendedOffer: string | null | undefined;
  decisionMakerConfidence: number | null | undefined;
  triggerFreshness?: TriggerFreshness | null;
};

export type CanSendInvariant = {
  ok: boolean;
  code: string;
  reason: string;
};

function fail(code: string, reason: string): CanSendInvariant {
  return { ok: false, code, reason };
}

/**
 * SEND is impossible unless every condition is true.
 * A high score cannot create eligibility. Missing fields fail closed.
 */
export function evaluateCanSend(input: CanSendInvariantInput): CanSendInvariant {
  if (input.killSwitch) {
    return fail("KILL_SWITCH", "Sends are paused. Kill switch is on.");
  }
  if (input.draftOnly) {
    return fail("DRAFT_ONLY", "Send mode is draft-only. Approve stays in the queue.");
  }
  if (input.humanApproval !== true) {
    return fail("NOT_APPROVED", "Draft is not APPROVED.");
  }
  if (typeof input.commercialScore !== "number" || input.commercialScore < DEFAULT_MIN_COMMERCIAL_SCORE) {
    return fail(
      "SCORE_BELOW_MINIMUM",
      `Commercial score ${input.commercialScore ?? "missing"} is below ${DEFAULT_MIN_COMMERCIAL_SCORE}. Score cannot create eligibility.`,
    );
  }
  if (input.commercialPriority !== true) {
    return fail(
      "PRIORITY_GATE",
      "Not a PRIORITY opportunity. A numerical score cannot create eligibility.",
    );
  }
  if (input.whyNowType !== "FACT") {
    return fail("WHY_NOW_NOT_FACT", "Why Now is not FACT. Send is impossible.");
  }
  if (!input.whyNowSourceUrl?.trim()) {
    return fail("WHY_NOW_NO_SOURCE", "Why Now has no source URL. Send is impossible.");
  }
  if (!input.whyNowSnippet?.trim()) {
    return fail("WHY_NOW_NO_SNIPPET", "Why Now has no evidence snippet. Send is impossible.");
  }
  if (!input.recommendedOffer?.trim()) {
    return fail("NO_OFFER", "No recommended your business offer. Send is impossible.");
  }
  if (typeof input.decisionMakerConfidence !== "number" || input.decisionMakerConfidence < DM_CONFIDENCE_SEND_THRESHOLD) {
    return fail("DM_CONFIDENCE", "Decision-maker confidence is below threshold. Send is impossible.");
  }
  if (input.triggerFreshness === "stale") {
    return fail("STALE_TRIGGER", "Why Now evidence is stale. Send is impossible.");
  }
  return { ok: true, code: "OK", reason: "All send invariants passed." };
}

/** Fixture evidence for tests that already prove kill-switch / channel / approval gates. */
export const PRODUCTION_SEND_EVIDENCE = {
  commercialScore: 82,
  commercialPriority: true as const,
  whyNowType: "FACT" as const,
  whyNowSourceUrl: "https://example.com/expansion",
  whyNowSnippet: "Opened charter operations in a new market this quarter.",
  recommendedOffer: "AI Sales / Lead Qualification System",
  decisionMakerConfidence: 86,
  triggerFreshness: "fresh" as const,
};

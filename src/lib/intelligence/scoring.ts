import type { LeadTemperature } from "@prisma/client";

import { clamp } from "@/lib/utils";
import type { LeadSignals } from "@/lib/intelligence/signals";
import type { DetectedOpportunity } from "@/lib/intelligence/opportunity";

export type ScoringWeights = {
  fit: number;
  need: number;
  intent: number;
  timing: number;
  accessibility: number;
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  fit: 25,
  need: 25,
  intent: 20,
  timing: 15,
  accessibility: 15,
};

export type QualificationPolicy = {
  hotMin: number;
  warmMin: number;
  coldMin: number;
};

export const DEFAULT_QUALIFICATION_POLICY: QualificationPolicy = {
  hotMin: 75,
  warmMin: 50,
  coldMin: 25,
};

export type QualificationDecision =
  | "QUALIFIED"
  | "HOLD"
  | "SKIP"
  | "INSUFFICIENT_EVIDENCE"
  | "INVALID";

export type ExplainableScore = {
  fit: number;
  need: number;
  intent: number;
  timing: number;
  accessibility: number;
  score: number;
  classification: LeadTemperature;
  decision: QualificationDecision;
  reasons: string[];
  risks: string[];
  unknowns: string[];
};

export function scoreFromSignals(
  signals: LeadSignals,
  opportunity: DetectedOpportunity,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  policy: QualificationPolicy = DEFAULT_QUALIFICATION_POLICY,
  blocked = false,
  extras?: { researchFailed?: boolean; invalid?: boolean },
): ExplainableScore {
  const reasons: string[] = [];
  const risks: string[] = [];
  const unknowns: string[] = ["Budget", "Current internal workflow"];

  let fit = 3;
  if (opportunity.opportunityKey !== "unknown") {
    fit += 14;
    reasons.push(`Named opportunity: ${opportunity.opportunityKey}.`);
  } else {
    risks.push("No named opportunity — fit is conservative.");
  }

  let need = 3;
  if (opportunity.confidence === "FACT") {
    need += 16;
    reasons.push("Need is stated in source text (FACT).");
  } else if (opportunity.confidence === "INFERENCE" && !signals.keyword_only) {
    need += 8;
    reasons.push("Need is inferred from operational evidence, not a stated request.");
  } else {
    risks.push("Need is UNKNOWN.");
    unknowns.push("Stated business problem");
  }

  let intent = 3;
  if (signals.explicit_request) {
    intent = 16;
    reasons.push("An explicit request is present.");
  } else {
    risks.push("No explicit buying request.");
    unknowns.push("Buying intent");
    if (signals.keyword_only) {
      intent = 2;
      risks.push("Keywords (AI/software/automation) are not treated as intent.");
    }
  }

  let timing =
    opportunity.confidence === "FACT" && opportunity.potentialImpact === "HIGH"
      ? 12
      : opportunity.confidence === "INFERENCE"
        ? 7
        : 3;
  reasons.push(`Opportunity impact labeled ${opportunity.potentialImpact} (${opportunity.confidence}).`);

  let accessibility = 2;
  if (signals.has_email) {
    accessibility += 7;
    reasons.push("Email is available.");
  }
  if (signals.has_linkedin) {
    accessibility += 4;
    reasons.push("LinkedIn URL is available.");
  }
  if (signals.has_phone) accessibility += 2;
  if (!signals.contact_available) {
    risks.push("No public contact channel.");
    unknowns.push("Contact path");
  }

  fit = clamp(fit, 0, 25);
  need = clamp(need, 0, 25);
  intent = clamp(intent, 0, 20);
  timing = clamp(timing, 0, 15);
  accessibility = clamp(accessibility, 0, 15);

  const raw =
    (fit / 25) * weights.fit +
    (need / 25) * weights.need +
    (intent / 20) * weights.intent +
    (timing / 15) * weights.timing +
    (accessibility / 15) * weights.accessibility;
  const score = Math.round(clamp(raw, 0, 100));

  const named = opportunity.opportunityKey !== "unknown";
  let decision: QualificationDecision = "SKIP";
  if (extras?.invalid) decision = "INVALID";
  else if (blocked) decision = "SKIP";
  else if (signals.keyword_only) decision = "SKIP";
  else if (extras?.researchFailed && !signals.explicit_request) decision = "INSUFFICIENT_EVIDENCE";
  else if (!named && (signals.thin_record || extras?.researchFailed)) decision = "INSUFFICIENT_EVIDENCE";
  else if (!named) decision = "SKIP";
  else if (score >= policy.warmMin && signals.explicit_request) decision = "QUALIFIED";
  else if (score >= policy.warmMin) decision = "HOLD";
  else if (score >= policy.coldMin && named) decision = "HOLD";
  else decision = "SKIP";

  const classification: LeadTemperature = blocked
    ? "DISQUALIFIED"
    : decision === "SKIP" || decision === "INSUFFICIENT_EVIDENCE" || decision === "INVALID"
      ? "DISQUALIFIED"
      : score >= policy.hotMin
        ? "HOT"
        : score >= policy.warmMin
          ? "WARM"
          : score >= policy.coldMin
            ? "COLD"
            : "DISQUALIFIED";

  if (blocked) risks.push("Lead is suppressed / do-not-contact.");
  if (decision === "SKIP") reasons.push("Decision: SKIP.");
  if (decision === "INSUFFICIENT_EVIDENCE") reasons.push("Decision: INSUFFICIENT_EVIDENCE.");

  return {
    fit,
    need,
    intent,
    timing,
    accessibility,
    score,
    classification,
    decision,
    reasons,
    risks,
    unknowns: [...new Set(unknowns)],
  };
}

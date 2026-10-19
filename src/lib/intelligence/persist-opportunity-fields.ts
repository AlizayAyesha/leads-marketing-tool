import type { Prisma } from "@prisma/client";
import type { ZarService } from "@prisma/client";

import type { LeadEvaluation } from "@/lib/intelligence/evaluate";
import type { OpportunitySelection } from "@/lib/intelligence/commercial";

export type PersistedOpportunityFields = {
  problem: string;
  evidence: string;
  evidenceUrl: string | null;
  recommendedService: ZarService;
  suggestedOffer: string;
  projectCategory: string;
  nextStep: string;
  confidence: string;
  selection: OpportunitySelection;
  icpId: string | null;
  score: number;
  evidenceItems: Prisma.InputJsonValue;
};

export function opportunityFieldsFromEvaluation(evaluation: LeadEvaluation): PersistedOpportunityFields {
  const commercial = evaluation.commercial;
  const detected = evaluation.opportunity;
  const solution = evaluation.solution;
  const offer = commercial.offer;
  const offerLine = `${offer.primary.replaceAll("_", " ")} primary${
    offer.secondary ? `; ${offer.secondary.replaceAll("_", " ")} secondary` : ""
  } (${offer.angle})`;
  const nextStep =
    commercial.brief.selection === "PRIORITY"
      ? "PRIORITY — draft Why Now for human approval. Do not send."
      : commercial.brief.selection === "NURTURE"
        ? "NURTURE — missing FACT Why Now or PRIORITY gate. Do not outbound."
        : "REJECT / HOLD — do not prepare outreach.";

  return {
    problem: detected.problem,
    evidence: detected.evidence,
    evidenceUrl: evaluation.normalized.website ?? null,
    recommendedService:
      commercial.brief.selection === "REJECT" ? (solution?.zarService ?? "CUSTOM_SOFTWARE") : offer.zarService,
    suggestedOffer:
      commercial.brief.selection === "REJECT"
        ? solution
          ? `${solution.name} — ${solution.reason}`
          : "No your business solution matched. Do not pitch a catalog item."
        : offerLine,
    projectCategory: detected.opportunityKey,
    nextStep,
    confidence:
      detected.confidence === "FACT" ? "observed" : detected.confidence === "INFERENCE" ? "inferred" : "unknown",
    selection: commercial.brief.selection,
    icpId: commercial.brief.icp,
    score: commercial.total,
    evidenceItems: [
      {
        text: detected.evidence,
        sourceUrl: evaluation.normalized.website,
        confidence: detected.confidence === "FACT" ? "observed" : "inferred",
      },
      {
        text: `BUY_NOW ${commercial.total} ${commercial.brief.selection} WhyNow=${commercial.brief.whyNow ?? "none"}`,
        sourceUrl: commercial.brief.triggerEvidence.find((item) => item.type === "FACT")?.sourceUrl ?? null,
        confidence: commercial.priority ? "observed" : "inferred",
      },
      {
        text: JSON.stringify({ commercialBrief: commercial.brief }),
        sourceUrl: null,
        confidence: "inferred",
      },
    ] as Prisma.InputJsonValue,
  };
}

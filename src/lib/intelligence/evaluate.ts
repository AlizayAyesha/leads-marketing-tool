import type { RawLeadInput, WebsiteSnapshot } from "@/types";
import { normalizeLead, type NormalizedLead } from "@/lib/leads/normalize";
import { extractSignals, type LeadSignals } from "@/lib/intelligence/signals";
import { detectOpportunity, type DetectedOpportunity } from "@/lib/intelligence/opportunity";
import { matchSolution, type SolutionMatch } from "@/lib/intelligence/solutions";
import {
  scoreFromSignals,
  type ExplainableScore,
  type QualificationDecision,
} from "@/lib/intelligence/scoring";
import { qualifyCommercial, type CommercialQualification } from "@/lib/intelligence/commercial";
import { prospectFromLeadFields } from "@/lib/intelligence/prospect";

export type LeadRowStatus =
  | "VALID"
  | "EMPTY"
  | "INVALID"
  | "DUPLICATE";

export type LeadEvaluation = {
  fixtureId: string;
  raw: RawLeadInput;
  normalized: NormalizedLead;
  rowStatus: LeadRowStatus;
  signals: LeadSignals;
  opportunity: DetectedOpportunity;
  solution: SolutionMatch | null;
  score: ExplainableScore;
  decision: QualificationDecision;
  shouldDraft: boolean;
  researchFailed: boolean;
  evidenceCount: number;
  unknowns: string[];
  reason: string;
  commercial: CommercialQualification;
};

export type EvaluateInput = {
  fixtureId?: string;
  raw: RawLeadInput;
  snapshot?: WebsiteSnapshot | null;
  blocked?: boolean;
  duplicate?: boolean;
  signals?: LeadSignals;
  roleTitle?: string | null;
  evidence?: import("@/lib/intelligence/evidence").EvidenceClaim[];
};

export function evaluateLead(input: EvaluateInput): LeadEvaluation {
  const fixtureId = input.fixtureId ?? input.raw.company ?? input.raw.email ?? "row";
  const normalized = normalizeLead(input.raw);
  const empty = !normalized.name && !normalized.company && !normalized.email && !normalized.website;
  const invalidUrl = Boolean(input.raw.website?.trim()) && !normalized.website;
  const researchFailed = Boolean(input.snapshot?.error) || (Boolean(normalized.website) && input.snapshot == null);
  const websiteQuality =
    input.snapshot && !input.snapshot.error
      ? qualityFromSnapshot(input.snapshot)
      : normalized.website
        ? null
        : 0;

  const signals = input.signals ?? extractSignals({
    ...normalized,
    websiteQuality,
  });
  const opportunity = detectOpportunity(signals, normalized.originalPost);
  const solution = matchSolution(opportunity);
  const invalid = empty || (invalidUrl && !normalized.company && !normalized.email);
  const score = scoreFromSignals(signals, opportunity, undefined, undefined, Boolean(input.blocked), {
    researchFailed: researchFailed && !signals.explicit_request,
    invalid: empty || invalid,
  });

  let rowStatus: LeadRowStatus = "VALID";
  if (empty) rowStatus = "EMPTY";
  else if (input.duplicate) rowStatus = "DUPLICATE";
  else if (invalid) rowStatus = "INVALID";

  const decision: QualificationDecision =
    rowStatus === "EMPTY" || rowStatus === "INVALID"
      ? "INVALID"
      : rowStatus === "DUPLICATE"
        ? "SKIP"
        : !solution && score.decision === "QUALIFIED"
          ? "HOLD"
          : score.decision;

  const commercial = qualifyCommercial(
    prospectFromLeadFields({
      ...normalized,
      name: normalized.name,
      roleTitle: input.roleTitle,
      suppressed: input.blocked,
      evidence: input.evidence,
    }),
  );

  const shouldDraft =
    rowStatus === "VALID" &&
    decision === "QUALIFIED" &&
    Boolean(solution) &&
    signals.contact_available &&
    !input.blocked &&
    commercial.priority;

  const evidenceCount = [
    signals.explicit_request,
    signals.operational_complexity,
    signals.website_exists && !researchFailed,
    Boolean(normalized.originalPost),
  ].filter(Boolean).length;

  const unknowns = [
    ...score.unknowns,
    ...(researchFailed ? ["Public website content"] : []),
    ...(invalidUrl ? ["Valid website URL"] : []),
  ];

  return {
    fixtureId,
    raw: input.raw,
    normalized,
    rowStatus,
    signals,
    opportunity,
    solution: decision === "SKIP" || decision === "INSUFFICIENT_EVIDENCE" || decision === "INVALID" ? null : solution,
    score: { ...score, decision },
    decision,
    shouldDraft,
    researchFailed,
    evidenceCount,
    unknowns: [...new Set(unknowns)],
    reason: [...score.reasons, ...score.risks].join(" "),
    commercial,
  };
}

function qualityFromSnapshot(snapshot: WebsiteSnapshot) {
  let quality = 4;
  if (snapshot.statusCode && snapshot.statusCode < 400) quality += 2;
  if (snapshot.title) quality += 1;
  if (snapshot.description) quality += 1;
  if (snapshot.hasViewport) quality += 1;
  return Math.max(0, Math.min(10, quality));
}

export function rawFromRecord(lead: {
  name?: string | null;
  company?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  twitterUrl?: string | null;
  industry?: string | null;
  location?: string | null;
  originalPost?: string | null;
  notes?: string | null;
  source?: string | null;
}): RawLeadInput {
  return {
    name: lead.name,
    company: lead.company,
    website: lead.website,
    email: lead.email,
    phone: lead.phone,
    linkedinUrl: lead.linkedinUrl,
    instagramUrl: lead.instagramUrl,
    facebookUrl: lead.facebookUrl,
    twitterUrl: lead.twitterUrl,
    industry: lead.industry,
    location: lead.location,
    originalPost: lead.originalPost,
    notes: lead.notes,
    source: lead.source,
  };
}

export function duplicateKey(normalized: NormalizedLead) {
  return normalized.email || normalized.websiteHost || normalized.linkedinUrl || null;
}

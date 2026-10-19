export const EVIDENCE_TYPES = ["FACT", "HYPOTHESIS", "INFERENCE", "UNKNOWN"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export type EvidenceClaim = {
  claim: string;
  type: EvidenceType;
  source: string | null;
  sourceUrl?: string | null;
  snippet?: string | null;
  timestamp: string;
  observedAt?: string;
  confidence: "high" | "medium" | "low" | number;
};

export type ObservedEvidence = {
  claim: string;
  sourceUrl: string | null;
  snippet: string;
  observedAt: string;
  confidence: number;
  type: "FACT" | "HYPOTHESIS" | "INFERENCE" | "UNKNOWN";
};

export type TriggerFreshness = "fresh" | "aging" | "stale" | "unknown";

const FRESH_MS = 270 * 24 * 60 * 60 * 1000;
const AGING_MS = 365 * 24 * 60 * 60 * 1000;
const STALE_TRIGGER_MS = 18 * 30 * 24 * 60 * 60 * 1000;

export function triggerAgeDays(observedAt: string, now = Date.now()) {
  const at = Date.parse(observedAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.round((now - at) / (24 * 60 * 60 * 1000)));
}

export function triggerFreshness(observedAt: string | null | undefined, now = Date.now()): TriggerFreshness {
  if (!observedAt) return "unknown";
  const at = Date.parse(observedAt);
  if (!Number.isFinite(at)) return "unknown";
  const age = now - at;
  if (age > STALE_TRIGGER_MS || age > AGING_MS * 1.5) return "stale";
  if (age > FRESH_MS) return "aging";
  return "fresh";
}

export function isStaleEvidence(observedAt: string, now = Date.now()) {
  return triggerFreshness(observedAt, now) === "stale";
}

export function asEvidenceType(value: string | undefined): EvidenceType {
  if (value === "FACT" || value === "HYPOTHESIS" || value === "INFERENCE" || value === "UNKNOWN") return value;
  if (value === "observed") return "FACT";
  if (value === "inferred") return "INFERENCE";
  return "UNKNOWN";
}

export function confidenceToNumber(value: EvidenceClaim["confidence"] | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)));
  if (value === "high") return 87;
  if (value === "medium") return 62;
  return 35;
}

/** No source URL (or no snippet) cannot be a factual sales claim. */
export function classifyObserved(input: {
  claim: string;
  sourceUrl?: string | null;
  snippet?: string | null;
  observedAt?: string | null;
  confidence?: EvidenceClaim["confidence"];
}): ObservedEvidence {
  const sourceUrl = input.sourceUrl?.trim() || null;
  const snippet = (input.snippet ?? "").trim();
  const observedAt = input.observedAt?.trim() || new Date().toISOString();
  const factual = Boolean(sourceUrl) && snippet.length > 0;
  return {
    claim: input.claim.trim(),
    sourceUrl,
    snippet,
    observedAt,
    confidence: confidenceToNumber(input.confidence),
    type: factual ? "FACT" : "HYPOTHESIS",
  };
}

export function normalizeClaimText(claim: string) {
  return claim.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Never promote an earlier INFERENCE / HYPOTHESIS / UNKNOWN into FACT
 * on a later research pass. A new FACT requires a new independent source+snippet.
 */
export function sealAgainstLaundering(
  next: EvidenceClaim,
  prior: EvidenceClaim[] = [],
): EvidenceClaim {
  const incomingType = asEvidenceType(next.type);
  const classified = classifyObserved({
    claim: next.claim,
    sourceUrl: next.sourceUrl ?? next.source,
    snippet: next.snippet ?? "",
    observedAt: next.observedAt ?? next.timestamp,
    confidence: next.confidence,
  });
  const locked: EvidenceClaim = {
    ...next,
    source: classified.sourceUrl,
    sourceUrl: classified.sourceUrl,
    snippet: classified.snippet,
    observedAt: classified.observedAt,
    timestamp: classified.observedAt,
    confidence: classified.confidence,
    type: classified.type,
  };
  if (incomingType !== "FACT") {
    locked.type = incomingType === "UNKNOWN" ? "INFERENCE" : incomingType;
    return locked;
  }
  const previous = prior.find((item) => normalizeClaimText(item.claim) === normalizeClaimText(next.claim));
  if (previous && previous.type !== "FACT") {
    const independentSource =
      Boolean(classified.sourceUrl) &&
      classified.sourceUrl !== (previous.sourceUrl || previous.source) &&
      Boolean(classified.snippet) &&
      classified.snippet !== (previous.snippet || "");
    if (!independentSource) {
      locked.type = previous.type === "UNKNOWN" ? "INFERENCE" : previous.type;
    }
  }
  return locked;
}

export function fromEvidenceClaim(claim: EvidenceClaim, prior: EvidenceClaim[] = []): ObservedEvidence {
  const sealed = sealAgainstLaundering(claim, prior);
  const observed = classifyObserved({
    claim: sealed.claim,
    sourceUrl: sealed.sourceUrl ?? sealed.source,
    snippet: sealed.snippet ?? "",
    observedAt: sealed.observedAt ?? sealed.timestamp,
    confidence: sealed.confidence,
  });
  if (sealed.type !== "FACT") {
    return { ...observed, type: sealed.type === "HYPOTHESIS" ? "HYPOTHESIS" : sealed.type === "UNKNOWN" ? "UNKNOWN" : "INFERENCE" };
  }
  return observed;
}

export function cannotInvent(claim: string): EvidenceClaim {
  return {
    claim,
    type: "UNKNOWN",
    source: null,
    sourceUrl: null,
    snippet: null,
    timestamp: new Date().toISOString(),
    confidence: "low",
  };
}

export function findingsToClaims(findings: unknown, prior: EvidenceClaim[] = []): EvidenceClaim[] {
  if (!Array.isArray(findings)) return [];
  const now = new Date().toISOString();
  const sealed: EvidenceClaim[] = [];
  for (const row of findings) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const claim = String(item.finding ?? item.claim ?? "").trim();
    if (!claim) continue;
    const snippet = String(item.evidence ?? item.snippet ?? "").trim();
    const sourceUrl = typeof item.sourceUrl === "string" ? item.sourceUrl : null;
    const labeled =
      item.confidence === "inferred" || item.type === "INFERENCE"
        ? "INFERENCE"
        : item.type === "HYPOTHESIS"
          ? "HYPOTHESIS"
          : item.type === "UNKNOWN"
            ? "UNKNOWN"
            : "FACT";
    const next: EvidenceClaim = {
      claim,
      type: labeled,
      source: sourceUrl,
      sourceUrl,
      snippet,
      timestamp: typeof item.observedAt === "string" ? item.observedAt : now,
      observedAt: typeof item.observedAt === "string" ? item.observedAt : now,
      confidence: item.confidence === "observed" || item.confidence === "high" ? "high" : "medium",
    };
    sealed.push(sealAgainstLaundering(next, [...prior, ...sealed]));
  }
  return sealed;
}

import type { LeadTemperature } from "@prisma/client";

export type QualificationView = {
  score: number;
  fit: number | null;
  need: number | null;
  intent: number | null;
  timing: number | null;
  access: number | null;
  evidence: string[];
  unknowns: string[];
  risks: string[];
  riskLevel: "Low" | "Medium" | "High";
  recommendedAction: string;
  reason: string;
};

const FIT_MAX = 25;
const NEED_MAX = 25;
const INTENT_MAX = 20;
const TIMING_MAX = 15;
const ACCESS_MAX = 15;

export function recommendedActionFor(score: number, temperature?: LeadTemperature | null) {
  if (temperature === "DISQUALIFIED" || score < 25) return "Do not contact";
  if (score >= 50) return "Prepare outreach";
  return "Hold — gather more evidence";
}

export function riskLevelFor(count: number): QualificationView["riskLevel"] {
  if (count >= 4) return "High";
  if (count >= 2) return "Medium";
  return "Low";
}

export function explainQualification(input: {
  score: number;
  reason?: string | null;
  temperature?: LeadTemperature | null;
  breakdown?: unknown;
  evidenceUsed?: unknown;
}): QualificationView {
  const breakdown = asRecord(input.breakdown);
  const evidenceUsed = Array.isArray(input.evidenceUsed)
    ? input.evidenceUsed.map(String)
    : [];
  const storedUnknowns = Array.isArray(breakdown.unknowns)
    ? breakdown.unknowns.map(String)
    : evidenceUsed.filter((item) => item.startsWith("unknown:")).map((item) => item.slice(8));
  const storedRisks = Array.isArray(breakdown.risks) ? breakdown.risks.map(String) : [];
  const reasonRisks = (input.reason ?? "")
    .split(/(?<=\.)\s+/)
    .map((item) => item.trim())
    .filter((item) => /unknown|no explicit|no public|suppressed|do-not-contact|conservative/i.test(item));
  const risks = unique([...storedRisks, ...reasonRisks]);
  const evidence = unique(
    evidenceUsed.filter((item) => !item.startsWith("unknown:") && !item.startsWith("no ")),
  );
  const unknowns = unique(
    storedUnknowns.length
      ? storedUnknowns
      : [
          !evidenceUsed.some((item) => item.includes("email present")) ? "Direct contact path" : "",
          "Current internal workflow",
          "Budget",
        ].filter(Boolean),
  );

  return {
    score: input.score,
    fit: num(breakdown.fit, FIT_MAX),
    need: num(breakdown.need, NEED_MAX),
    intent: num(breakdown.intent, INTENT_MAX),
    timing: num(breakdown.timing, TIMING_MAX),
    access: num(breakdown.accessibility ?? breakdown.access, ACCESS_MAX),
    evidence,
    unknowns,
    risks,
    riskLevel: riskLevelFor(risks.length),
    recommendedAction:
      typeof breakdown.recommendedAction === "string"
        ? breakdown.recommendedAction
        : recommendedActionFor(input.score, input.temperature),
    reason: input.reason ?? "",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown, max: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.min(Math.max(value, 0), max);
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

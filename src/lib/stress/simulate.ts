import { normalizeLead } from "@/lib/leads/normalize";
import { STRESS_FIXTURE, type FixtureLead } from "@/lib/stress/fixture";
import { duplicateKey, evaluateLead, type LeadEvaluation } from "@/lib/intelligence/evaluate";
import { attemptExternalAction } from "@/lib/intelligence/approval";
import { mapConcurrent } from "@/lib/queue/concurrent";

export const EXTERNAL_MESSAGES_SENT = 0 as const;

export type SimulationLeadRow = {
  lead: string;
  status: string;
  score: number;
  problem: string;
  opportunity: string;
  solution: string | null;
  evidenceCount: number;
  unknowns: string[];
  reason: string;
  decision: string;
  drafted: boolean;
};

export type SimulationReport = {
  jobId: string;
  totalInput: number;
  valid: number;
  invalid: number;
  duplicates: number;
  empty: number;
  researched: number;
  researchFailed: number;
  opportunities: number;
  qualified: number;
  skipped: number;
  insufficientEvidence: number;
  drafts: number;
  processed: number;
  successful: number;
  failed: number;
  external_messages_sent: 0;
  leads: SimulationLeadRow[];
  evaluations: LeadEvaluation[];
};

export async function runFixtureSimulation(fixture: FixtureLead[] = STRESS_FIXTURE): Promise<SimulationReport> {
  const seen = new Set<string>();
  const prepared = fixture.map((row) => {
    const normalized = normalizeLead(row.raw);
    const key = duplicateKey(normalized);
    const duplicate = Boolean(key && seen.has(key));
    if (key && !duplicate) seen.add(key);
    return { row, duplicate };
  });

  const settled = await mapConcurrent(prepared, 4, async ({ row, duplicate }) => {
    return evaluateLead({
      fixtureId: row.id,
      raw: row.raw,
      snapshot: row.snapshot === undefined ? null : row.snapshot,
      duplicate,
    });
  });

  const evaluations: LeadEvaluation[] = [];
  let failed = 0;
  for (const item of settled) {
    if (item.status === "fulfilled") evaluations.push(item.value);
    else failed += 1;
  }

  const leads: SimulationLeadRow[] = evaluations.map((item) => ({
    lead: item.fixtureId,
    status: item.rowStatus === "VALID" ? item.decision : item.rowStatus,
    score: item.score.score,
    problem: item.opportunity.problem,
    opportunity: item.opportunity.opportunityKey,
    solution: item.solution?.slug ?? null,
    evidenceCount: item.evidenceCount,
    unknowns: item.unknowns,
    reason: item.reason,
    decision: item.decision,
    drafted: item.shouldDraft,
  }));

  const empty = evaluations.filter((item) => item.rowStatus === "EMPTY").length;
  const duplicates = evaluations.filter((item) => item.rowStatus === "DUPLICATE").length;
  const invalid = evaluations.filter((item) => item.rowStatus === "INVALID").length;
  const valid = evaluations.filter((item) => item.rowStatus === "VALID").length;
  const researchFailed = evaluations.filter((item) => item.researchFailed).length;
  const researched = evaluations.filter((item) => item.rowStatus === "VALID" && !item.researchFailed).length;
  const opportunities = evaluations.filter((item) => item.opportunity.opportunityKey !== "unknown").length;
  const qualified = evaluations.filter((item) => item.decision === "QUALIFIED").length;
  const skipped = evaluations.filter((item) => item.decision === "SKIP" || item.rowStatus === "DUPLICATE").length;
  const insufficientEvidence = evaluations.filter((item) => item.decision === "INSUFFICIENT_EVIDENCE").length;
  const drafts = evaluations.filter((item) => item.shouldDraft).length;

  try {
    attemptExternalAction({ approvalStatus: "PENDING_APPROVAL" });
    throw new Error("Approval gate failed: PENDING_APPROVAL was allowed to send.");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("EXTERNAL_ACTION_BLOCKED")) {
      throw error;
    }
  }

  return {
    jobId: "JOB-STRESS-FIXTURE",
    totalInput: fixture.length,
    valid,
    invalid: invalid + empty,
    duplicates,
    empty,
    researched,
    researchFailed,
    opportunities,
    qualified,
    skipped,
    insufficientEvidence,
    drafts,
    processed: evaluations.length,
    successful: evaluations.filter((item) => item.rowStatus !== "EMPTY").length,
    failed,
    external_messages_sent: EXTERNAL_MESSAGES_SENT,
    leads,
    evaluations,
  };
}

export function formatSimulationReport(report: SimulationReport) {
  const lines = [
    `JOB ID ${report.jobId}`,
    `TOTAL INPUT ${report.totalInput}`,
    `VALID ${report.valid}`,
    `INVALID ${report.invalid}`,
    `DUPLICATES ${report.duplicates}`,
    `RESEARCHED ${report.researched}`,
    `RESEARCH FAILED ${report.researchFailed}`,
    `OPPORTUNITIES ${report.opportunities}`,
    `QUALIFIED ${report.qualified}`,
    `SKIPPED ${report.skipped}`,
    `DRAFTS ${report.drafts}`,
    `EXTERNAL MESSAGES SENT ${report.external_messages_sent}`,
    "",
  ];
  for (const row of report.leads) {
    lines.push(
      [
        `Lead ${row.lead}`,
        `Status ${row.status}`,
        `Score ${row.score}`,
        `Problem ${row.problem}`,
        `Opportunity ${row.opportunity}`,
        `Solution ${row.solution ?? "none"}`,
        `Evidence count ${row.evidenceCount}`,
        `Unknowns ${row.unknowns.join("; ") || "none"}`,
        `Reason ${row.reason}`,
      ].join("\n"),
      "",
    );
  }
  return lines.join("\n");
}

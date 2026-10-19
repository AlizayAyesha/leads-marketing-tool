import type { WorkforcePlan } from "./types";

export function parseCount(command: string, fallback = 20) {
  const text = command.toLowerCase();
  const match =
    text.match(/(?:find me|research|process|import|simulate)\s+(\d+)/i) ??
    command.match(/(\d+)\s+(?:companies|leads|prospects|drafts)/i);
  const value = match ? Number(match[1]) : fallback;
  return Math.min(Math.max(Number.isFinite(value) ? value : fallback, 1), 50);
}

export function workforceStages(limit: number, top: number) {
  return [
    "IMPORT",
    "VALIDATE",
    `RESEARCH × ${limit}`,
    `SIGNALS × ${limit}`,
    `OPPORTUNITIES × ${limit}`,
    `QUALIFY × ${limit}`,
    `SELECT TOP ${top}`,
    `DRAFT × ${top}`,
    "WAIT FOR YOU",
  ];
}

export function openingFor(limit: number) {
  return `I'll research ${limit} companies from the connected sources. I'll prioritize companies showing observable software, automation, growth, or digital-product signals. I'll prepare opportunities and outreach drafts. Nothing will be sent without your approval.`;
}

export function parseWorkforceCommand(command: string): WorkforcePlan | null {
  const text = command.toLowerCase().trim();
  if (!text) return null;

  const simulate = /simulate/.test(text);
  const sheet = /sheet|workbook|google sheet/.test(text);
  const findCompanies = /find me\s+\d+|could potentially need|need your services/.test(text);
  const fullLoop =
    (sheet && /research|opportunit|draft|outreach|qualif/.test(text)) ||
    /take the new leads|strongest opportunities|show me the drafts|process (my |the )?(sheet|leads|pipeline)/.test(
      text,
    );

  if (!simulate && !findCompanies && !fullLoop) return null;

  const limit = parseCount(command, findCompanies ? 50 : 20);
  const top = Math.min(Math.max(Math.round(limit * 0.3), 3), 15);
  const intent = simulate ? "SIMULATE_CAMPAIGN" : "PROCESS_WORKFORCE";

  return {
    intent,
    importSheet: sheet,
    limit,
    top,
    simulate,
    stages: workforceStages(limit, top),
    opening: openingFor(limit),
  };
}

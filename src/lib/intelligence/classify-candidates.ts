import type { OpportunitySelection } from "@/lib/intelligence/commercial";

export const CLASSIFIED_SELECTIONS: OpportunitySelection[] = ["PRIORITY", "NURTURE", "REJECT"];

export function isClassifiedSelection(selection: string | null | undefined): selection is OpportunitySelection {
  return CLASSIFIED_SELECTIONS.includes(selection as OpportunitySelection);
}

export type ClassifyCandidateLead = {
  id: string;
  createdAt: Date;
  selection?: string | null;
};

/** Prefer new-this-run unclassified leads, then fill with older unclassified inventory. */
export function mergeClassifyBatch<T extends ClassifyCandidateLead>(
  newThisRun: T[],
  existingUnclassified: T[],
  cap = 40,
): { batch: T[]; newThisRunCount: number; existingCount: number } {
  const limit = Math.min(Math.max(cap, 1), 40);
  const seen = new Set<string>();
  const batch: T[] = [];

  for (const lead of newThisRun) {
    if (batch.length >= limit) break;
    if (seen.has(lead.id)) continue;
    if (isClassifiedSelection(lead.selection)) continue;
    seen.add(lead.id);
    batch.push(lead);
  }

  const newThisRunCount = batch.length;

  for (const lead of existingUnclassified) {
    if (batch.length >= limit) break;
    if (seen.has(lead.id)) continue;
    if (isClassifiedSelection(lead.selection)) continue;
    seen.add(lead.id);
    batch.push(lead);
  }

  return {
    batch,
    newThisRunCount,
    existingCount: batch.length - newThisRunCount,
  };
}

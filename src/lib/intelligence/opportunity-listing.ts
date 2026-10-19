/** Operator listing is PRIORITY only. Ingested companies are candidates, not the queue. */
export const LIST_OPPORTUNITY_SELECTION = "PRIORITY" as const;

export function isListableOpportunity(selection: string | null | undefined): boolean {
  return selection === LIST_OPPORTUNITY_SELECTION;
}

export function listableOpportunities<T extends { selection?: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => isListableOpportunity(row.selection));
}

/**
 * A finished actor dataset still needs to be read into leads.
 * Rows that already recorded a result count were imported before `datasetImported` existed.
 */
export function actorDatasetNeedsImport(row: {
  status: string;
  datasetId?: string | null;
  datasetImported?: boolean | null;
  resultCount?: number | null;
  ingestedNew?: number | null;
}) {
  if (row.status !== "SUCCEEDED" || !row.datasetId) return false;
  if (row.datasetImported) return false;
  if ((row.ingestedNew ?? 0) > 0) return false;
  if ((row.resultCount ?? 0) > 0) return false;
  return true;
}

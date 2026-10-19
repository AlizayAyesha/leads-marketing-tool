function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseFirecrawlSearchPayload(payload: Record<string, unknown>) {
  const data = payload.data;
  if (Array.isArray(data)) return data;
  const nested = asRecord(data);
  if (!nested) return [];
  for (const key of ["web", "organic", "results", "news"]) {
    const rows = nested[key];
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

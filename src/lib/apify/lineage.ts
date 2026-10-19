export type ApifySourceRef = {
  source: "APIFY";
  actor_id: string;
  run_id: string | null;
  dataset_id: string | null;
  imported_at: string;
};

export type WrappedApifyRecord = ApifySourceRef & {
  raw_record: unknown;
};

export function apifySourceRef(input: {
  actorId: string;
  runId?: string | null;
  datasetId?: string | null;
  importedAt?: string;
}): ApifySourceRef {
  return {
    source: "APIFY",
    actor_id: input.actorId,
    run_id: input.runId ?? null,
    dataset_id: input.datasetId ?? null,
    imported_at: input.importedAt ?? new Date().toISOString(),
  };
}

export function wrapApifyRecord(item: unknown, ref: ApifySourceRef): WrappedApifyRecord {
  return { ...ref, raw_record: item };
}

export function mergeSourceRefs(existing: unknown, next: ApifySourceRef): ApifySourceRef[] {
  const current = Array.isArray(existing) ? (existing as ApifySourceRef[]) : [];
  const already = current.some(
    (item) =>
      item?.source === "APIFY" &&
      item.actor_id === next.actor_id &&
      item.run_id === next.run_id &&
      item.dataset_id === next.dataset_id,
  );
  return already ? current : [...current, next];
}

export function unwrapRawRecord(payload: unknown) {
  if (payload && typeof payload === "object" && "raw_record" in payload) {
    return (payload as WrappedApifyRecord).raw_record;
  }
  return payload;
}

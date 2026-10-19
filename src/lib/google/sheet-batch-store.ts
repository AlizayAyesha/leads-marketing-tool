import "server-only";

import { getSetting, setSetting } from "@/lib/db/settings";
import type { SheetBatchRecord } from "@/lib/google/sheet-batch";

const KEY = "sheet.scrape.batch";

export async function getSheetBatch(): Promise<SheetBatchRecord | null> {
  const row = await getSetting<SheetBatchRecord | null>(KEY, null);
  if (!row || typeof row.fingerprint !== "string") return null;
  return row;
}

export async function getSheetBatchStatus() {
  const batch = await getSheetBatch();
  return {
    exhausted: Boolean(batch?.usedAt),
    fingerprint: batch?.fingerprint ?? null,
    importedAt: batch?.importedAt ?? null,
    usedAt: batch?.usedAt ?? null,
    stored: batch?.stored ?? 0,
    duplicates: batch?.duplicates ?? 0,
    leadCount: batch?.leadCount ?? 0,
  };
}

export async function recordSheetImport(input: {
  fingerprint: string;
  stored: number;
  duplicates: number;
  leadCount: number;
}) {
  const previous = await getSheetBatch();
  const same = previous?.fingerprint === input.fingerprint;
  const next: SheetBatchRecord = {
    fingerprint: input.fingerprint,
    importedAt: new Date().toISOString(),
    usedAt: same ? previous?.usedAt ?? null : null,
    stored: input.stored,
    duplicates: input.duplicates,
    leadCount: input.leadCount,
  };
  await setSetting(KEY, next);
  return next;
}

export async function markSheetBatchUsed() {
  const previous = await getSheetBatch();
  if (!previous) return null;
  const next: SheetBatchRecord = { ...previous, usedAt: new Date().toISOString() };
  await setSetting(KEY, next);
  return next;
}

export async function markSheetBatchFresh() {
  const previous = await getSheetBatch();
  if (!previous) return null;
  const next: SheetBatchRecord = { ...previous, usedAt: null };
  await setSetting(KEY, next);
  return next;
}

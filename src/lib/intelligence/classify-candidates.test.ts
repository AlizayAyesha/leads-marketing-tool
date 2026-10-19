import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isClassifiedSelection, mergeClassifyBatch } from "./classify-candidates";

describe("classify candidate batching", () => {
  it("prefers new-this-run unclassified leads before older inventory", () => {
    const since = new Date("2026-09-16T10:00:00Z");
    const newThisRun = [
      { id: "a", createdAt: new Date("2026-09-16T11:00:00Z"), selection: null },
      { id: "b", createdAt: new Date("2026-09-16T10:30:00Z"), selection: null },
    ];
    const existing = [{ id: "c", createdAt: new Date("2026-09-15T10:00:00Z"), selection: null }];
    const merged = mergeClassifyBatch(newThisRun, existing, 2);
    assert.deepEqual(merged.batch.map((row) => row.id), ["a", "b"]);
    assert.equal(merged.newThisRunCount, 2);
    assert.equal(merged.existingCount, 0);
    assert.ok(newThisRun.every((row) => row.createdAt >= since));
  });

  it("fills remaining capacity with existing unclassified leads", () => {
    const merged = mergeClassifyBatch(
      [{ id: "new", createdAt: new Date("2026-09-16T12:00:00Z"), selection: null }],
      [
        { id: "old-1", createdAt: new Date("2026-09-10T12:00:00Z"), selection: null },
        { id: "old-2", createdAt: new Date("2026-09-09T12:00:00Z"), selection: null },
      ],
      3,
    );
    assert.deepEqual(merged.batch.map((row) => row.id), ["new", "old-1", "old-2"]);
    assert.equal(merged.newThisRunCount, 1);
    assert.equal(merged.existingCount, 2);
  });

  it("never selects already classified leads and caps at 40", () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({
      id: `lead-${index}`,
      createdAt: new Date(`2026-09-${String((index % 28) + 1).padStart(2, "0")}T12:00:00Z`),
      selection: index % 5 === 0 ? "PRIORITY" : null,
    }));
    const merged = mergeClassifyBatch(rows, [], 40);
    assert.equal(merged.batch.length, 40);
    assert.ok(merged.batch.every((row) => !isClassifiedSelection(row.selection)));
  });
});

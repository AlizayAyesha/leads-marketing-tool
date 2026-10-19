import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fingerprintSheetIdentities, isSheetBatchExhausted, type SheetBatchRecord } from "./sheet-batch";

const used: SheetBatchRecord = {
  fingerprint: "abc",
  importedAt: "2026-01-01T00:00:00.000Z",
  usedAt: "2026-01-02T00:00:00.000Z",
  stored: 8,
  duplicates: 0,
  leadCount: 8,
};

describe("sheet scrape batch", () => {
  it("fingerprints the same people the same way regardless of order", () => {
    const a = fingerprintSheetIdentities([
      { email: "ops@acme.example" },
      { linkedinUrl: "https://www.linkedin.com/in/buyer" },
    ]);
    const b = fingerprintSheetIdentities([
      { linkedinUrl: "https://www.linkedin.com/in/buyer" },
      { email: "OPS@acme.example" },
    ]);
    assert.equal(a, b);
  });

  it("asks for a new scrape when the same used sheet has no new rows", () => {
    assert.equal(
      isSheetBatchExhausted({
        previous: { ...used, fingerprint: fingerprintSheetIdentities([{ email: "ops@acme.example" }]) },
        fingerprint: fingerprintSheetIdentities([{ email: "ops@acme.example" }]),
        stored: 0,
        duplicates: 8,
      }),
      true,
    );
  });

  it("does not ask when the sheet has new people", () => {
    assert.equal(
      isSheetBatchExhausted({
        previous: used,
        fingerprint: fingerprintSheetIdentities([{ email: "new@buyer.example" }]),
        stored: 3,
        duplicates: 8,
      }),
      false,
    );
  });

  it("does not ask when the operator reuses the old scrape on purpose", () => {
    assert.equal(
      isSheetBatchExhausted({
        previous: used,
        fingerprint: used.fingerprint,
        stored: 0,
        duplicates: 8,
        reuse: true,
      }),
      false,
    );
  });
});

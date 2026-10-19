import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeHost } from "@/lib/utils";

describe("known website host normalization", () => {
  it("strips www and normalizes hostnames consistently with ingest dedupe", () => {
    assert.equal(safeHost("https://www.jetex.com/contact"), "jetex.com");
    assert.equal(safeHost("http://JETEX.COM"), "jetex.com");
    assert.equal(safeHost("not-a-url"), null);
  });
});

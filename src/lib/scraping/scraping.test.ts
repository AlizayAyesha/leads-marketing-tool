import assert from "node:assert/strict";
import test from "node:test";

import { boundedInput, validateScrapingUrl } from "./safety";

test("scraping safety blocks local and credentialed URLs", () => {
  assert.throws(() => validateScrapingUrl("http://127.0.0.1/admin"), /blocked/);
  assert.throws(() => validateScrapingUrl("https://user:pass@example.com"), /credentials/);
  assert.throws(() => validateScrapingUrl("file:///etc/passwd"), /HTTP/);
});

test("scraping safety enforces domain allowlists and bounded execution", () => {
  assert.equal(validateScrapingUrl("https://www.example.com/a", ["example.com"]), "https://www.example.com/a");
  assert.throws(() => validateScrapingUrl("https://example.org", ["example.com"]), /allowlist/);
  assert.deepEqual(boundedInput({ maxRequests: 999, maxConcurrency: 99, requestDelayMs: 0 }).maxRequests, 100);
});

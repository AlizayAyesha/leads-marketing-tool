import assert from "node:assert/strict";
import test from "node:test";

import { fallbackSpokenReply } from "./voice-text";

test("spoken fallback strips urls and extra space", () => {
  assert.equal(
    fallbackSpokenReply("See https://acme.example/go/website  for  booking."),
    "See for booking.",
  );
});

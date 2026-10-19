import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getLinkedInConnectionStatusProvider } from "@/lib/linkedin/connection/registry";
import { UnavailableLinkedInConnectionStatusProvider } from "@/lib/linkedin/connection/unavailable-provider";
import { getLinkedInSendProvider } from "@/lib/linkedin/send/registry";
import { LINKEDIN_SEND_UNAVAILABLE, LINKEDIN_SEND_UNAVAILABLE_REASON } from "@/lib/linkedin/send/types";
import { UnavailableLinkedInSendProvider } from "@/lib/linkedin/send/unavailable";
import { resetChromeToolForTests } from "@/lib/tools/chrome";

describe("LinkedIn send registry", () => {
  it("has no live sending provider while Chrome is disconnected and fails closed", async () => {
    resetChromeToolForTests();
    const provider = getLinkedInSendProvider();
    assert.ok(provider instanceof UnavailableLinkedInSendProvider);
    assert.equal(provider.configured, false);
    const result = await provider.send({
      leadId: "lead-1",
      profileUrl: "https://www.linkedin.com/in/example/",
      kind: "connection",
      body: "hello",
      idempotencyKey: "test",
    });
    assert.equal(result.sent, false);
    assert.equal(result.code, LINKEDIN_SEND_UNAVAILABLE);
    assert.equal(result.reason, LINKEDIN_SEND_UNAVAILABLE_REASON);
  });
});

describe("LinkedIn connection status registry", () => {
  it("has no authorized status source so CONNECTED cannot be assumed", async () => {
    resetChromeToolForTests();
    const provider = getLinkedInConnectionStatusProvider();
    assert.ok(provider instanceof UnavailableLinkedInConnectionStatusProvider);
    assert.equal(provider.configured, false);
    const status = await provider.fetchStatus({
      profileUrl: "https://www.linkedin.com/in/example/",
      normalizedUrl: "https://www.linkedin.com/in/example/",
    });
    assert.equal(status.result, "UNKNOWN");
  });
});

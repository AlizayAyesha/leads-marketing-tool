import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inspectAgentReachLinkedInCapabilities } from "@/lib/agent-reach/capabilities";
import { isLinkedInPublicAuthWall, readLinkedInPublicPage } from "@/lib/agent-reach/jina";
import { AgentReachLinkedInProvider } from "@/lib/linkedin/agent-reach-provider";
import { getLinkedInSendProvider } from "@/lib/linkedin/send/registry";
import { LINKEDIN_SEND_UNAVAILABLE } from "@/lib/linkedin/send/types";
import { resetChromeToolForTests } from "@/lib/tools/chrome";

const PROFILE = "https://www.linkedin.com/in/sam-tester-example/";
const AUTH_WALL = `Title: Sign Up | LinkedIn

URL Source: https://www.linkedin.com/in/sam-tester-example/

Markdown Content:
Agree & Join LinkedIn
# Join LinkedIn
`;

describe("Agent-Reach LinkedIn capabilities", () => {
  it("does not claim Agent-Reach can send connections or messages", () => {
    const caps = inspectAgentReachLinkedInCapabilities({ cli: false, mcporter: false, uvx: false });
    assert.equal(caps.search, false);
    assert.equal(caps.connectionRequests, false);
    assert.equal(caps.messages, false);
    assert.equal(caps.sendAvailable, false);
    assert.equal(caps.authenticatedActions, false);
    assert.equal(caps.zeroConfigBackend, "jina-reader");
  });

  it("treats a LinkedIn signup wall as not evidence", () => {
    assert.equal(isLinkedInPublicAuthWall(AUTH_WALL, "Sign Up | LinkedIn"), true);
  });

  it("records the public-read failure instead of inventing a profile", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(AUTH_WALL, { status: 200, headers: { "content-type": "text/plain" } });
    const page = await readLinkedInPublicPage(PROFILE, { fetchImpl });
    assert.equal(page.ok, false);
    assert.equal(page.authWall, true);
    const provider = new AgentReachLinkedInProvider({ fetchImpl, configured: true });
    const result = await provider.fetchProfile({ profileUrl: PROFILE, normalizedUrl: PROFILE });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.profile, null);
    assert.equal(result.evidence.length, 0);
    assert.match(result.code, /AUTH_WALL|JINA/);
  });

  it("does not enable LinkedIn sending", async () => {
    resetChromeToolForTests();
    const send = await getLinkedInSendProvider().send({
      leadId: "test",
      profileUrl: PROFILE,
      kind: "connection",
      body: "test",
      idempotencyKey: "test",
    });
    assert.equal(send.sent, false);
    assert.equal(send.code, LINKEDIN_SEND_UNAVAILABLE);
  });
});

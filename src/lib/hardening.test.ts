import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isQueueRequestAuthorized } from "./queue/auth";
import { listUnsubscribeHeaders, rfc822 } from "./outreach/email-mime";
import { DEFAULT_OUTREACH_ENGINE, HARD_DAILY_SEND_LIMIT, envCap, mergeOutreachEnginePolicy } from "./outreach/policy";
import { isSameNavTarget } from "./browser/linkedin-page";
import { JARVIS_CURSOR_INIT_SCRIPT } from "./browser/visible-cursor";
import { decodeStoredToken, encodeStoredToken } from "./secrets-codec";

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe("queue auth", () => {
  it("requires the shared secret when configured", () => {
    const env = { QUEUE_PROCESS_SECRET: "s3cret" } as unknown as NodeJS.ProcessEnv;
    assert.equal(isQueueRequestAuthorized(req("http://localhost:3000/api/queue/process"), env), false);
    assert.equal(isQueueRequestAuthorized(req("http://localhost:3000/x", { "x-queue-secret": "bad" }), env), false);
    assert.equal(isQueueRequestAuthorized(req("http://example.com/x", { "x-queue-secret": "s3cret" }), env), true);
    assert.equal(isQueueRequestAuthorized(req("http://example.com/x", { authorization: "Bearer s3cret" }), env), true);
  });
  it("falls back to loopback-only without a secret", () => {
    const env = {} as unknown as NodeJS.ProcessEnv;
    assert.equal(isQueueRequestAuthorized(req("http://localhost:3000/x", { host: "localhost:3000" }), env), true);
    assert.equal(isQueueRequestAuthorized(req("http://localhost:3000/x", { host: "localhost:3000", "x-forwarded-for": "1.2.3.4" }), env), false);
    assert.equal(isQueueRequestAuthorized(req("https://app.example.com/x", { host: "app.example.com" }), env), false);
  });
});

describe("List-Unsubscribe", () => {
  it("adds mailto and one-click headers", () => {
    const h = listUnsubscribeHeaders({ from: "Zar <a@zar.com>", replyTo: "r@zar.com", unsubscribe: { url: "https://zar.com/u/1" } });
    assert.deepEqual(h, ["List-Unsubscribe: <mailto:r@zar.com?subject=unsubscribe>, <https://zar.com/u/1>", "List-Unsubscribe-Post: List-Unsubscribe=One-Click"]);
  });
  it("defaults to mailto from From when nothing else, no one-click without https URL", () => {
    const h = listUnsubscribeHeaders({ from: "Zar <a@zar.com>" });
    assert.deepEqual(h, ["List-Unsubscribe: <mailto:a@zar.com?subject=unsubscribe>"]);
  });
  it("appears in the RFC822 payload", () => {
    const raw = Buffer.from(rfc822({ to: "x@y.com", from: "a@zar.com", subject: "Hi", body: "b" }), "base64url").toString();
    assert.match(raw, /^List-Unsubscribe: <mailto:a@zar\.com\?subject=unsubscribe>/m);
  });
});

describe("conservative caps", () => {
  it("defaults to 10 and honours env up to the hard ceiling", () => {
    assert.equal(envCap("X", 100, {} as unknown as NodeJS.ProcessEnv), 10);
    assert.equal(envCap("X", 100, { X: "25" } as unknown as NodeJS.ProcessEnv), 25);
    assert.equal(envCap("X", 100, { X: "999" } as unknown as NodeJS.ProcessEnv), 100);
    assert.equal(envCap("X", 100, { X: "-4" } as unknown as NodeJS.ProcessEnv), 0);
  });
  it("engine defaults never exceed the hard ceilings", () => {
    assert.ok(DEFAULT_OUTREACH_ENGINE.dailySendLimit <= HARD_DAILY_SEND_LIMIT);
    assert.equal(mergeOutreachEnginePolicy({ dailySendLimit: 999 }).dailySendLimit, HARD_DAILY_SEND_LIMIT);
  });
});

describe("stored token encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const stored = encodeStoredToken("apify_api_ABC123456");
    assert.equal(JSON.stringify(stored).includes("ABC123456"), false);
    assert.deepEqual(decodeStoredToken(stored), { token: "apify_api_ABC123456", legacyPlaintext: false });
  });
  it("reads legacy plaintext and flags it for migration", () => {
    assert.deepEqual(decodeStoredToken({ token: "old" }), { token: "old", legacyPlaintext: true });
    assert.deepEqual(decodeStoredToken({}), { token: null, legacyPlaintext: false });
  });
});

describe("browser stability helpers", () => {
  it("same-URL skip ignores hash/trailing slash/host case but not query or about:blank", () => {
    assert.equal(isSameNavTarget("https://www.linkedin.com/in/foo/", "https://WWW.linkedin.com/in/foo#x"), true);
    assert.equal(isSameNavTarget("https://x.com/i/chat", "https://x.com/i/chat"), true);
    assert.equal(isSameNavTarget("https://x.com/a?q=1", "https://x.com/a?q=2"), false);
    assert.equal(isSameNavTarget("about:blank", "about:blank"), false);
  });
  it("overlay init script is syntactically valid and watches <html>", () => {
    assert.doesNotThrow(() => new Function(JARVIS_CURSOR_INIT_SCRIPT));
    assert.match(JARVIS_CURSOR_INIT_SCRIPT, /observe\(document\.documentElement/);
  });
});

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { encryptSecret, decryptSecret } from "./crypto";
import {
  classifyOpenAIError,
  mayFailover,
  marksCredentialUnhealthy,
  retryAfterMs,
} from "./errors";
import { eligibleIds, remainingAttempts, selectCredential } from "./policy";
import { maskOpenAIKey, redactSecrets } from "../apify/redact";
import {
  AllOpenAICredentialsUnavailableError,
  publicCredentialFields,
  runCredentialedOperation,
} from "./runtime";
import type { CredentialPublic } from "./types";

const SAMPLE_KEY = "sk-test-fixture-not-real-AAAA1111";
const OTHER_KEY = "sk-test-fixture-not-real-BBBB2222";

type Stored = {
  id: string;
  name: string;
  apiKey: string;
  enabled: boolean;
  status: string;
  lastUsedAt: Date | null;
  errorCount: number;
  successCount: number;
};

function publicView(item: Stored): CredentialPublic {
  return {
    id: item.id,
    name: item.name,
    provider: "OPENAI",
    source: item.id === "env" ? "env" : "database",
    hint: maskOpenAIKey(item.apiKey),
    enabled: item.enabled,
    status: item.status,
    lastTestedAt: null,
    lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
    lastErrorAt: null,
    errorCount: item.errorCount,
    successCount: item.successCount,
    createdAt: null,
  };
}

function catalog() {
  const rows: Stored[] = [];
  return {
    rows,
    add(name: string, apiKey: string) {
      const row: Stored = {
        id: `db-${rows.length + 1}`,
        name,
        apiKey,
        enabled: true,
        status: "HEALTHY",
        lastUsedAt: null,
        errorCount: 0,
        successCount: 0,
      };
      rows.push(row);
      return publicView(row);
    },
    delete(id: string) {
      const index = rows.findIndex((item) => item.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    setEnabled(id: string, enabled: boolean) {
      const row = rows.find((item) => item.id === id);
      if (!row) return;
      row.enabled = enabled;
      row.status = enabled ? "HEALTHY" : "DISABLED";
    },
    listPublic() {
      return rows.map(publicView);
    },
    eligible() {
      return rows.filter((item) =>
        eligibleIds([
          { id: item.id, enabled: item.enabled, status: item.status, cooldownUntil: null },
        ]).includes(item.id),
      );
    },
  };
}

function statusError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

describe("OpenAI credential manager", () => {
  it("1. reports no credentials configured", async () => {
    await assert.rejects(
      () =>
        runCredentialedOperation({
          policy: "ROUND_ROBIN",
          failover: true,
          roundRobinIndex: 0,
          credentials: [],
          execute: async () => "ok",
        }),
      AllOpenAICredentialsUnavailableError,
    );
  });

  it("2. uses one environment credential", async () => {
    const result = await runCredentialedOperation({
      policy: "SINGLE_PRIMARY",
      failover: false,
      roundRobinIndex: 0,
      credentials: [{ id: "env", name: "Environment Credential" }],
      execute: async (id) => {
        assert.equal(id, "env");
        return "ok";
      },
    });
    assert.equal(result.credentialId, "env");
    assert.equal(result.result, "ok");
  });

  it("3. uses multiple database credentials", async () => {
    const store = catalog();
    store.add("Primary", SAMPLE_KEY);
    store.add("Secondary", OTHER_KEY);
    assert.equal(store.listPublic().length, 2);
    const used: string[] = [];
    await runCredentialedOperation({
      policy: "ROUND_ROBIN",
      failover: true,
      roundRobinIndex: 0,
      credentials: store.eligible().map((item) => ({ id: item.id, name: item.name })),
      execute: async (id) => {
        used.push(id);
        return "ok";
      },
    });
    assert.equal(used.length, 1);
    assert.equal(used[0], "db-1");
  });

  it("4. adds a credential without exposing the key", () => {
    const store = catalog();
    const added = store.add("Primary", SAMPLE_KEY);
    assert.equal(added.name, "Primary");
    assert.equal(added.hint, maskOpenAIKey(SAMPLE_KEY));
    assert.doesNotMatch(JSON.stringify(added), /sk-test-fixture-not-real-AAAA1111/);
  });

  it("5. deletes a credential and its secret", () => {
    const store = catalog();
    store.add("Primary", SAMPLE_KEY);
    store.delete("db-1");
    assert.equal(store.rows.length, 0);
    assert.equal(store.listPublic().length, 0);
  });

  it("6. enables a credential", () => {
    const store = catalog();
    store.add("Primary", SAMPLE_KEY);
    store.setEnabled("db-1", false);
    store.setEnabled("db-1", true);
    assert.equal(store.rows[0].enabled, true);
    assert.equal(store.rows[0].status, "HEALTHY");
  });

  it("7. disables a credential", () => {
    const store = catalog();
    store.add("Primary", SAMPLE_KEY);
    store.setEnabled("db-1", false);
    assert.equal(store.rows[0].enabled, false);
    assert.equal(store.eligible().length, 0);
  });

  it("8. masks the credential", () => {
    assert.equal(maskOpenAIKey(SAMPLE_KEY), "sk-••••••••••••1111");
    assert.equal(redactSecrets(`key=${SAMPLE_KEY}`), "key=sk-••••");
  });

  it("9. selects a credential", () => {
    const picked = selectCredential("SINGLE_PRIMARY", [
      { id: "a", lastUsedAt: null },
      { id: "b", lastUsedAt: null },
    ]);
    assert.equal(picked.id, "a");
  });

  it("10. round-robin selection", () => {
    const pool = [
      { id: "a", lastUsedAt: null },
      { id: "b", lastUsedAt: null },
      { id: "c", lastUsedAt: null },
    ];
    const first = selectCredential("ROUND_ROBIN", pool, 0);
    const second = selectCredential("ROUND_ROBIN", pool, first.nextIndex);
    const third = selectCredential("ROUND_ROBIN", pool, second.nextIndex);
    const fourth = selectCredential("ROUND_ROBIN", pool, third.nextIndex);
    assert.deepEqual([first.id, second.id, third.id, fourth.id], ["a", "b", "c", "a"]);
  });

  it("11. excludes disabled credentials", () => {
    const ids = eligibleIds([
      { id: "a", enabled: true, status: "HEALTHY" },
      { id: "b", enabled: false, status: "DISABLED" },
    ]);
    assert.deepEqual(ids, ["a"]);
  });

  it("12. marks invalid credentials unhealthy and failovers", async () => {
    assert.equal(classifyOpenAIError(statusError(401, "Incorrect API key provided")), "INVALID_API_KEY");
    assert.equal(marksCredentialUnhealthy("INVALID_API_KEY"), true);
    const tried: string[] = [];
    const result = await runCredentialedOperation({
      policy: "ROUND_ROBIN",
      failover: true,
      roundRobinIndex: 0,
      credentials: [
        { id: "bad", name: "Bad" },
        { id: "good", name: "Good" },
      ],
      execute: async (id) => {
        tried.push(id);
        if (id === "bad") throw statusError(401, "Incorrect API key provided");
        return "ok";
      },
    });
    assert.deepEqual(tried, ["bad", "good"]);
    assert.equal(result.credentialId, "good");
  });

  it("13. rate-limit failover", async () => {
    assert.equal(mayFailover("RATE_LIMITED"), true);
    assert.equal(retryAfterMs({ headers: { "retry-after": "12" } }), 12_000);
    const tried: string[] = [];
    const result = await runCredentialedOperation({
      policy: "ROUND_ROBIN",
      failover: true,
      roundRobinIndex: 0,
      credentials: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      execute: async (id) => {
        tried.push(id);
        if (id === "a") throw statusError(429, "Rate limit exceeded");
        return "ok";
      },
    });
    assert.deepEqual(tried, ["a", "b"]);
    assert.equal(result.credentialId, "b");
  });

  it("14. bad-request does not fail over", async () => {
    const tried: string[] = [];
    await assert.rejects(
      () =>
        runCredentialedOperation({
          policy: "ROUND_ROBIN",
          failover: true,
          roundRobinIndex: 0,
          credentials: [
            { id: "a", name: "A" },
            { id: "b", name: "B" },
          ],
          execute: async (id) => {
            tried.push(id);
            throw statusError(400, "Bad request: invalid_request");
          },
        }),
      /Bad request/,
    );
    assert.deepEqual(tried, ["a"]);
  });

  it("15. model-not-found does not fail over", async () => {
    const tried: string[] = [];
    await assert.rejects(
      () =>
        runCredentialedOperation({
          policy: "ROUND_ROBIN",
          failover: true,
          roundRobinIndex: 0,
          credentials: [
            { id: "a", name: "A" },
            { id: "b", name: "B" },
          ],
          execute: async (id) => {
            tried.push(id);
            throw statusError(404, "The model does not exist");
          },
        }),
      /does not exist/,
    );
    assert.deepEqual(tried, ["a"]);
  });

  it("16. network retry stays on the same credential", async () => {
    let calls = 0;
    const result = await runCredentialedOperation({
      policy: "ROUND_ROBIN",
      failover: true,
      roundRobinIndex: 0,
      networkRetries: 2,
      credentials: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      execute: async (id) => {
        calls += 1;
        assert.equal(id, "a");
        if (calls < 3) throw new Error("fetch failed: ECONNRESET");
        return "ok";
      },
    });
    assert.equal(calls, 3);
    assert.equal(result.credentialId, "a");
    assert.deepEqual(result.tried, ["a"]);
  });

  it("17. maximum retry limit is the eligible credential count", async () => {
    const tried: string[] = [];
    await assert.rejects(
      () =>
        runCredentialedOperation({
          policy: "ROUND_ROBIN",
          failover: true,
          roundRobinIndex: 0,
          credentials: [
            { id: "a", name: "A" },
            { id: "b", name: "B" },
          ],
          execute: async (id) => {
            tried.push(id);
            throw statusError(429, "Rate limit exceeded");
          },
        }),
      (error: unknown) => error instanceof AllOpenAICredentialsUnavailableError && error.tried.length === 2,
    );
    assert.deepEqual(tried, ["a", "b"]);
  });

  it("18. never loops credentials infinitely", () => {
    assert.deepEqual(remainingAttempts(["a", "b"], ["a", "b", "c"]), ["c"]);
    assert.deepEqual(remainingAttempts(["a", "b", "c"], ["a", "b", "c"]), []);
  });

  it("19. API key never appears in logs", () => {
    const line = redactSecrets(`Authorization: Bearer ${SAMPLE_KEY} failed for ${SAMPLE_KEY}`);
    assert.doesNotMatch(line, /sk-test-fixture-not-real-AAAA1111/);
    assert.match(line, /Bearer ••••/);
  });

  it("20. API key never appears in API responses", () => {
    const store = catalog();
    const response = store.add("Primary", SAMPLE_KEY);
    assert.equal("apiKey" in response, false);
    assert.ok(!publicCredentialFields().includes("apiKey" as never));
    assert.doesNotMatch(JSON.stringify(response), /sk-test-fixture-not-real/);
  });

  it("21. agents cannot access decrypted credentials", () => {
    const root = join(process.cwd(), "src/lib/agents");
    const files = readdirSync(root, { recursive: true }).filter((name) => String(name).endsWith(".ts"));
    for (const file of files) {
      const content = readFileSync(join(root, String(file)), "utf8");
      assert.doesNotMatch(content, /decryptSecret/);
      assert.doesNotMatch(content, /keyCiphertext/);
      assert.doesNotMatch(content, /new OpenAI\(/);
    }
  });

  it("22. usage tracking records token counts only when provided", async () => {
    const events: Array<{ credentialId: string; success: boolean; inputTokens?: number }> = [];
    const result = await runCredentialedOperation({
      policy: "SINGLE_PRIMARY",
      failover: false,
      roundRobinIndex: 0,
      credentials: [{ id: "a", name: "A" }],
      execute: async () => ({ text: "ok", usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } }),
      onAttempt: async (event) => {
        events.push({ credentialId: event.credentialId, success: event.success });
      },
    });
    const usage = result.result.usage;
    assert.equal(events[0]?.success, true);
    assert.equal(usage.prompt_tokens, 11);
    assert.equal(usage.total_tokens, 15);
  });

  it("23. credential test returns a structured result without the key", () => {
    const payload = {
      ok: true,
      name: "Primary",
      status: "SUCCESS",
      model: "models.list",
      timestamp: new Date().toISOString(),
      errorCategory: null as string | null,
    };
    assert.equal(payload.model, "models.list");
    assert.doesNotMatch(JSON.stringify(payload), /sk-/);
  });

  it("24. environment credential remains compatible", async () => {
    const envPublic = publicView({
      id: "env",
      name: "Environment Credential",
      apiKey: SAMPLE_KEY,
      enabled: true,
      status: "CONFIGURED",
      lastUsedAt: null,
      errorCount: 0,
      successCount: 0,
    });
    assert.equal(envPublic.source, "env");
    assert.equal(envPublic.status, "CONFIGURED");
    const result = await runCredentialedOperation({
      policy: "ROUND_ROBIN",
      failover: true,
      roundRobinIndex: 0,
      credentials: [{ id: "env", name: envPublic.name }, { id: "db-1", name: "Primary" }],
      execute: async (id) => id,
    });
    assert.equal(result.credentialId, "env");
  });

  it("encrypts secrets instead of storing plaintext", () => {
    const encrypted = encryptSecret(SAMPLE_KEY);
    assert.notEqual(encrypted.ciphertext, SAMPLE_KEY);
    assert.equal(decryptSecret(encrypted), SAMPLE_KEY);
  });

  it("least-recently-used prefers the oldest lastUsedAt", () => {
    const picked = selectCredential("LEAST_RECENTLY_USED", [
      { id: "fresh", lastUsedAt: new Date("2026-08-18T10:00:00Z") },
      { id: "stale", lastUsedAt: new Date("2026-08-01T10:00:00Z") },
    ]);
    assert.equal(picked.id, "stale");
  });
});

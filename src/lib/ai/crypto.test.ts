import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CredentialEncryptionKeyError, decryptSecret, encryptSecret, rotateEnvelope } from "@/lib/ai/crypto";

const current = { CREDENTIAL_ENCRYPTION_KEY: "ab".repeat(32) } as unknown as NodeJS.ProcessEnv;
const previous = { CREDENTIAL_ENCRYPTION_KEY: "cd".repeat(32), CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: "ab".repeat(32) } as unknown as NodeJS.ProcessEnv;

describe("credential encryption", () => {
  it("refuses a missing key, the old fallback, and a database URL", () => {
    assert.throws(() => encryptSecret("sk-test", {} as unknown as NodeJS.ProcessEnv), CredentialEncryptionKeyError);
    assert.throws(() => encryptSecret("sk-test", { CREDENTIAL_ENCRYPTION_KEY: "jarvis-local-credential-key" } as unknown as NodeJS.ProcessEnv), /fallback/);
    assert.throws(() => encryptSecret("sk-test", { CREDENTIAL_ENCRYPTION_KEY: "postgresql://leads:leads@localhost/db" } as unknown as NodeJS.ProcessEnv), /database/i);
  });

  it("round-trips and can read a previous key without deleting an undecryptable value", () => {
    const encrypted = encryptSecret("sk-test-fixture", current);
    assert.equal(JSON.stringify(encrypted).includes("sk-test-fixture"), false);
    assert.equal(decryptSecret(encrypted, current), "sk-test-fixture");
    const rotated = rotateEnvelope(encrypted, previous);
    assert.equal(rotated.ok, true);
    if (rotated.ok && rotated.envelope) assert.equal(decryptSecret(rotated.envelope, previous), "sk-test-fixture");
    const blocked = rotateEnvelope({ ciphertext: "nope", iv: "aa", tag: "bb" }, current);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.envelope, null);
  });
});

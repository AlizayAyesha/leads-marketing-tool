import { createCipheriv, createDecipheriv, randomBytes, type CipherKey } from "node:crypto";

export class CredentialEncryptionKeyError extends Error {
  code = "CREDENTIAL_ENCRYPTION_KEY_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "CredentialEncryptionKeyError";
  }
}

export type SecretEnvelope = {
  v: 1;
  kid: "current" | "previous";
  ciphertext: string;
  iv: string;
  tag: string;
};

const REJECTED = new Set(["jarvis-local-credential-key"]);

/** 32-byte key: 64 hex characters or standard base64. Never DATABASE_URL and never a fixed string. */
export function parseEncryptionKey(raw: string | undefined, label = "CREDENTIAL_ENCRYPTION_KEY") {
  const value = raw?.trim() ?? "";
  if (!value) {
    throw new CredentialEncryptionKeyError(
      `${label} is not set. Jarvis will not encrypt with DATABASE_URL or a built-in fallback.`,
    );
  }
  if (REJECTED.has(value) || value.startsWith("postgres://") || value.startsWith("postgresql://")) {
    throw new CredentialEncryptionKeyError(`${label} must be a dedicated key, not a database URL or the removed fallback.`);
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 32 && !value.includes("-") && value.length >= 43) return decoded;
  throw new CredentialEncryptionKeyError(`${label} must be 32 bytes as 64 hex characters or standard base64.`);
}

function aesKey(key: Buffer): CipherKey {
  return new Uint8Array(key);
}

export function encryptWithKey(plain: string, key: Buffer, kid: SecretEnvelope["kid"] = "current"): SecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey(key), new Uint8Array(iv));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    kid,
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptWithKey(input: { ciphertext: string; iv: string; tag: string }, key: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", aesKey(key), new Uint8Array(Buffer.from(input.iv, "base64")));
  decipher.setAuthTag(new Uint8Array(Buffer.from(input.tag, "base64")));
  return Buffer.concat([decipher.update(new Uint8Array(Buffer.from(input.ciphertext, "base64"))), decipher.final()]).toString("utf8");
}

export function loadEncryptionKeys(env: NodeJS.ProcessEnv = process.env) {
  return {
    current: parseEncryptionKey(env.CREDENTIAL_ENCRYPTION_KEY, "CREDENTIAL_ENCRYPTION_KEY"),
    previous: env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS?.trim()
      ? parseEncryptionKey(env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS, "CREDENTIAL_ENCRYPTION_KEY_PREVIOUS")
      : null,
  };
}

export function encryptSecret(plain: string, env: NodeJS.ProcessEnv = process.env): SecretEnvelope {
  return encryptWithKey(plain, loadEncryptionKeys(env).current, "current");
}

export function decryptSecret(
  input: { ciphertext: string; iv: string; tag: string; kid?: string | null },
  env: NodeJS.ProcessEnv = process.env,
) {
  const keys = loadEncryptionKeys(env);
  const order: Buffer[] = [];
  if (input.kid === "previous") {
    if (!keys.previous) {
      throw new CredentialEncryptionKeyError("Ciphertext is tagged previous, but CREDENTIAL_ENCRYPTION_KEY_PREVIOUS is not set.");
    }
    order.push(keys.previous);
  } else {
    order.push(keys.current);
    if (keys.previous) order.push(keys.previous);
  }
  let last: unknown;
  for (const key of order) {
    try {
      return decryptWithKey(input, key);
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("Unable to decrypt secret.");
}

/**
 * Re-encrypt one envelope with the current key. Returns null when the value cannot be
 * decrypted — callers must keep the original row.
 */
export function rotateEnvelope(
  input: { ciphertext: string; iv: string; tag: string; kid?: string | null },
  env: NodeJS.ProcessEnv = process.env,
) {
  try {
    const plain = decryptSecret(input, env);
    return { ok: true as const, envelope: encryptSecret(plain, env) };
  } catch {
    return { ok: false as const, envelope: null };
  }
}

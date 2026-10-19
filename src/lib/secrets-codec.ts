import { decryptSecret, encryptSecret } from "@/lib/ai/crypto";

export type StoredSecret = { enc?: { ciphertext: string; iv: string; tag: string }; token?: string };

/** Encrypt (AES-256-GCM, same key material as OpenAI credentials) instead of storing plaintext. */
export function encodeStoredToken(token: string): StoredSecret {
  const trimmed = token.trim();
  if (!trimmed) return {};
  return { enc: encryptSecret(trimmed) };
}

/** Reads encrypted values and legacy plaintext `{ token }` rows. `legacyPlaintext` tells the caller to re-save encrypted. */
export function decodeStoredToken(stored: StoredSecret | null | undefined): { token: string | null; legacyPlaintext: boolean } {
  if (stored?.enc) {
    try {
      return { token: decryptSecret(stored.enc), legacyPlaintext: false };
    } catch {
      return { token: null, legacyPlaintext: false };
    }
  }
  if (stored?.token) return { token: stored.token, legacyPlaintext: true };
  return { token: null, legacyPlaintext: false };
}

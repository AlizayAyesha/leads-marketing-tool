import "server-only";

import { getEnv } from "@/lib/env";
import { getSetting, setSetting } from "@/lib/db/settings";
import { maskSecret } from "@/lib/apify/redact";
import { decodeStoredToken, encodeStoredToken, type StoredSecret } from "@/lib/secrets-codec";

export { maskSecret } from "@/lib/apify/redact";

const APIFY_SETTING = "secrets.apify.token";

export async function getApifyToken() {
  const fromEnv = getEnv().apifyToken;
  if (fromEnv) return { token: fromEnv, source: "env" as const };
  const stored = await getSetting<StoredSecret>(APIFY_SETTING, {});
  const decoded = decodeStoredToken(stored);
  if (decoded.token) {
    // Migrate legacy plaintext rows to encrypted storage on first read (best effort).
    if (decoded.legacyPlaintext) await setSetting(APIFY_SETTING, encodeStoredToken(decoded.token)).catch(() => undefined);
    return { token: decoded.token, source: "settings" as const };
  }
  return { token: null, source: null };
}

export async function saveApifyToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    await setSetting(APIFY_SETTING, {});
    return;
  }
  await setSetting(APIFY_SETTING, encodeStoredToken(trimmed));
}

export async function apifyTokenPublicStatus() {
  const resolved = await getApifyToken();
  return {
    configured: Boolean(resolved.token),
    source: resolved.source,
    hint: maskSecret(resolved.token),
  };
}

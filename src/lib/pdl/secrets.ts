import "server-only";

import { getEnv } from "@/lib/env";
import { getSetting, setSetting } from "@/lib/db/settings";
import { maskSecret } from "@/lib/apify/redact";

const PDL_SETTING = "secrets.pdl.apiKey";

export async function getPdlApiKey() {
  const fromEnv = getEnv().pdlApiKey;
  if (fromEnv) return { token: fromEnv, source: "env" as const };
  const stored = await getSetting<{ token?: string }>(PDL_SETTING, {});
  if (stored.token) return { token: stored.token, source: "settings" as const };
  return { token: null, source: null };
}

export async function savePdlApiKey(token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    await setSetting(PDL_SETTING, {});
    return;
  }
  await setSetting(PDL_SETTING, { token: trimmed });
}

export async function pdlTokenPublicStatus() {
  const resolved = await getPdlApiKey();
  return {
    configured: Boolean(resolved.token),
    source: resolved.source,
    hint: maskSecret(resolved.token),
  };
}

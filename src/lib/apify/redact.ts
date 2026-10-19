export function maskSecret(value: string | null | undefined) {
  if (!value) return null;
  if (value.length < 8) return "••••";
  return `••••${value.slice(-4)}`;
}

export function maskOpenAIKey(value: string | null | undefined) {
  if (!value) return null;
  return `sk-••••••••••••${value.slice(-4)}`;
}

export function redactSecrets(text: string, secrets: Array<string | null | undefined> = []) {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue;
    out = out.split(secret).join(maskSecret(secret) ?? "••••");
  }
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ••••")
    .replace(/apify_api_[A-Za-z0-9]+/gi, "apify_api_••••")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-••••");
}

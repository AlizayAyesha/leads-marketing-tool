import { createHmac, timingSafeEqual } from "node:crypto";

export type UnsubscribeClaims = {
  v: 1;
  email: string;
  leadId: string;
  tenantId: string;
  exp: number;
};

function secret(env: NodeJS.ProcessEnv) {
  return env.UNSUBSCRIBE_TOKEN_SECRET?.trim() || "";
}

export function unsubscribeConfigured(env: NodeJS.ProcessEnv = process.env) {
  return secret(env).length >= 16;
}

export function signUnsubscribeToken(claims: Omit<UnsubscribeClaims, "v">, env: NodeJS.ProcessEnv = process.env) {
  const key = secret(env);
  if (key.length < 16) {
    throw new Error("UNSUBSCRIBE_TOKEN_SECRET must be at least 16 characters. Refusing to mint an unsigned link.");
  }
  const payload = Buffer.from(JSON.stringify({ v: 1, ...claims })).toString("base64url");
  const sig = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(token: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()): UnsubscribeClaims | null {
  const key = secret(env);
  if (key.length < 16) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", key).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UnsubscribeClaims;
    if (parsed.v !== 1 || !parsed.email || !parsed.leadId || !parsed.tenantId) return null;
    if (!Number.isFinite(parsed.exp) || parsed.exp * 1000 < now) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function unsubscribeUrl(token: string, env: NodeJS.ProcessEnv = process.env) {
  const base = (env.APP_URL ?? "").trim().replace(/\/$/, "");
  if (!base) return "";
  return `${base}/api/v1/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function signWebhookBody(secretValue: string, body: string) {
  return `sha256=${createHmac("sha256", secretValue).update(body).digest("hex")}`;
}

export function verifyWebhookSignature(secretValue: string, body: string, header: string | null) {
  if (!secretValue || !header) return false;
  const expected = signWebhookBody(secretValue, body);
  const a = Buffer.from(header.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

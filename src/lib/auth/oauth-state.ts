import { createHmac, timingSafeEqual } from "node:crypto";

export type OAuthState = {
  kind: "sheets" | "sender" | "outreach";
  tenantId: string;
  sub: string;
};

function key(secret: string) {
  return createHmac("sha256", secret);
}

export function signOAuthState(state: OAuthState, secret: string) {
  const payload = Buffer.from(JSON.stringify({ v: 1, ...state })).toString("base64url");
  const sig = key(secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function readOAuthState(raw: string | null, secret: string): OAuthState | null {
  if (!raw || !secret) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = key(secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState & { v?: number };
    if (parsed.v !== 1 || !parsed.tenantId || !parsed.kind) return null;
    if (parsed.kind !== "sheets" && parsed.kind !== "sender" && parsed.kind !== "outreach") return null;
    return { kind: parsed.kind, tenantId: parsed.tenantId, sub: parsed.sub || "" };
  } catch {
    return null;
  }
}

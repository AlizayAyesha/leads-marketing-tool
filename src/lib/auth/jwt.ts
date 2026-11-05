import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, SignJWT, type JWTPayload } from "jose";

import { authAudience, supabaseIssuer } from "@/lib/auth/config";
import { SESSION_AUDIENCE, SESSION_ISSUER } from "@/lib/auth/constants";
import type { OperatorRole, Principal } from "@/lib/auth/types";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export class TokenVerificationError extends Error {
  code: "INVALID_TOKEN" | "AUTH_NOT_CONFIGURED";

  constructor(code: "INVALID_TOKEN" | "AUTH_NOT_CONFIGURED", message: string) {
    super(message);
    this.name = "TokenVerificationError";
    this.code = code;
  }
}

function jwksFor(issuer: string) {
  const existing = jwksCache.get(issuer);
  if (existing) return existing;
  const set = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  jwksCache.set(issuer, set);
  return set;
}

export function resetJwksCache() {
  jwksCache.clear();
}

export async function verifySupabaseAccessToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { jwks?: Parameters<typeof jwtVerify>[1] } = {},
): Promise<JWTPayload> {
  const issuer = supabaseIssuer(env);
  const audience = authAudience(env);
  const secret = env.SUPABASE_JWT_SECRET?.trim() || "";
  if (!issuer && !secret) {
    throw new TokenVerificationError(
      "AUTH_NOT_CONFIGURED",
      "Set AUTH_JWT_ISSUER or NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_JWT_SECRET for HS256 projects.",
    );
  }
  let alg = "";
  try {
    alg = decodeProtectedHeader(token).alg ?? "";
  } catch {
    throw new TokenVerificationError("INVALID_TOKEN", "Access token is not a JWT.");
  }
  if (alg === "none" || !alg) {
    throw new TokenVerificationError("INVALID_TOKEN", "Access token algorithm is not allowed.");
  }
  try {
    if (alg === "HS256") {
      if (!secret) {
        throw new TokenVerificationError("AUTH_NOT_CONFIGURED", "HS256 access tokens require SUPABASE_JWT_SECRET.");
      }
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ["HS256"],
        issuer: issuer || undefined,
        audience,
      });
      return payload;
    }
    if (!issuer) {
      throw new TokenVerificationError("AUTH_NOT_CONFIGURED", "Asymmetric access tokens require the Supabase issuer URL.");
    }
    const { payload } = await jwtVerify(token, options.jwks ?? jwksFor(issuer), {
      algorithms: ["ES256", "RS256", "EdDSA"],
      issuer,
      audience,
    });
    return payload;
  } catch (error) {
    if (error instanceof TokenVerificationError) throw error;
    throw new TokenVerificationError("INVALID_TOKEN", "Access token signature, issuer, audience, or expiry was rejected.");
  }
}

function sessionKey(env: NodeJS.ProcessEnv) {
  const secret = env.JARVIS_SESSION_SECRET?.trim() || "";
  if (secret.length < 32) {
    throw new TokenVerificationError("AUTH_NOT_CONFIGURED", "JARVIS_SESSION_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(
  principal: Pick<Principal, "sub" | "email" | "role" | "tenantId" | "source">,
  env: NodeJS.ProcessEnv = process.env,
  ttl = "12h",
) {
  return new SignJWT({
    email: principal.email,
    role: principal.role,
    tenantId: principal.tenantId,
    source: principal.source === "worker" ? "session" : principal.source,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(principal.sub)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(sessionKey(env));
}

export async function verifySessionToken(token: string, env: NodeJS.ProcessEnv = process.env): Promise<Principal> {
  try {
    const { payload } = await jwtVerify(token, sessionKey(env), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    const tenantId = typeof payload.tenantId === "string" ? payload.tenantId : "";
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!sub || !tenantId) throw new Error("missing subject");
    const role: OperatorRole = payload.role === "ADMIN" ? "ADMIN" : "OPERATOR";
    const source = payload.source === "dev" ? "dev" : payload.source === "bearer" ? "bearer" : "session";
    return {
      sub,
      email: typeof payload.email === "string" ? payload.email : "",
      role,
      tenantId,
      source,
      scope: "tenant",
    };
  } catch (error) {
    if (error instanceof TokenVerificationError) throw error;
    throw new TokenVerificationError("INVALID_TOKEN", "Session cookie was rejected.");
  }
}

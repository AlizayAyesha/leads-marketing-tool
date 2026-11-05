import { SESSION_COOKIE } from "@/lib/auth/constants";
import { decideTenant, readAccessClaims } from "@/lib/auth/claims";
import { authEnforcement } from "@/lib/auth/config";
import { verifySessionToken, verifySupabaseAccessToken, TokenVerificationError } from "@/lib/auth/jwt";
import type { AuthErrorBody, OperatorRole, Principal } from "@/lib/auth/types";

export type MembershipRecord = { tenantId: string; role: OperatorRole } | null;

export type AuthenticateDeps = {
  env: NodeJS.ProcessEnv;
  lookupMembership: (sub: string) => Promise<MembershipRecord>;
  verifyAccessToken?: typeof verifySupabaseAccessToken;
};

export type AuthenticateResult =
  | { ok: true; principal: Principal }
  | { ok: false; status: number; body: AuthErrorBody };

function fail(status: number, code: AuthErrorBody["error"]["code"], message: string): AuthenticateResult {
  return { ok: false, status, body: { error: { code, message } } };
}

export function readCookie(header: string | null, name: string) {
  if (!header) return "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)/i.exec(header);
  return match?.[1]?.trim() ?? "";
}

/**
 * Verifies a Supabase access token (Authorization bearer) or a Jarvis session cookie
 * that was minted only after such a token was verified. Browser-supplied user ids are ignored.
 */
export async function authenticateRequest(request: Request, deps: AuthenticateDeps): Promise<AuthenticateResult> {
  const bearer = bearerToken(request);
  if (bearer) {
    try {
      const payload = await (deps.verifyAccessToken ?? verifySupabaseAccessToken)(bearer, deps.env);
      const claims = readAccessClaims(payload);
      if (!claims.sub) return fail(401, "INVALID_TOKEN", "Access token has no subject.");
      const membership = claims.tenantId ? null : await deps.lookupMembership(claims.sub);
      const tenant = decideTenant({ claims, membership, env: deps.env });
      if (!tenant.ok) return fail(403, tenant.code, tenant.message);
      const principal: Principal = {
        sub: claims.sub,
        email: claims.email,
        role: tenant.role,
        tenantId: tenant.tenantId,
        source: "bearer",
        scope: "tenant",
      };
      return { ok: true, principal };
    } catch (error) {
      if (error instanceof TokenVerificationError && error.code === "AUTH_NOT_CONFIGURED") {
        return fail(503, "AUTH_NOT_CONFIGURED", error.message);
      }
      return fail(401, "INVALID_TOKEN", error instanceof Error ? error.message : "Access token was rejected.");
    }
  }

  const cookie = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (cookie) {
    try {
      const principal = await verifySessionToken(cookie, deps.env);
      return { ok: true, principal };
    } catch (error) {
      if (error instanceof TokenVerificationError && error.code === "AUTH_NOT_CONFIGURED") {
        return fail(503, "AUTH_NOT_CONFIGURED", error.message);
      }
      return fail(401, "INVALID_TOKEN", "Session cookie was rejected.");
    }
  }

  if (authEnforcement(deps.env) === "open") {
    return fail(401, "UNAUTHENTICATED", "No access token or session cookie was sent.");
  }
  return fail(401, "UNAUTHENTICATED", "Sign in through Zar Labs. This service does not accept a client-supplied user id.");
}

export function sessionSetCookie(token: string, env: NodeJS.ProcessEnv = process.env) {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 60 * 60}${secure}`;
}

export function sessionClearCookie(env: NodeJS.ProcessEnv = process.env) {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

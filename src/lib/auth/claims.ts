import type { JWTPayload } from "jose";

import { bootstrapEmails, bootstrapEnabled, defaultTenantId } from "@/lib/auth/config";
import type { AccessClaims, OperatorRole } from "@/lib/auth/types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function roleFrom(value: unknown): OperatorRole {
  return value === "ADMIN" ? "ADMIN" : "OPERATOR";
}

/**
 * Tenant and role come only from app_metadata (set with the Supabase service role)
 * or from an existing membership. user_metadata is caller-controlled and ignored.
 */
export function readAccessClaims(payload: JWTPayload): Omit<AccessClaims, "issuer" | "audience"> & {
  issuer: string;
  audience: string[];
} {
  const app = asRecord(payload.app_metadata);
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const tenant = typeof app?.tenant_id === "string" && app.tenant_id.trim() ? app.tenant_id.trim() : null;
  const aud = payload.aud;
  const audience = Array.isArray(aud) ? aud.map(String) : aud ? [String(aud)] : [];
  return {
    sub: typeof payload.sub === "string" ? payload.sub : "",
    email,
    role: roleFrom(app?.role),
    tenantId: tenant,
    issuer: typeof payload.iss === "string" ? payload.iss : "",
    audience,
  };
}

export type TenantDecision =
  | { ok: true; tenantId: string; role: OperatorRole; via: "app_metadata" | "membership" | "bootstrap" }
  | { ok: false; code: "TENANT_UNASSIGNED"; message: string };

export function decideTenant(input: {
  claims: Pick<AccessClaims, "email" | "role" | "tenantId" | "sub">;
  membership: { tenantId: string; role: OperatorRole } | null;
  env?: NodeJS.ProcessEnv;
}): TenantDecision {
  const env = input.env ?? process.env;
  if (input.claims.tenantId) {
    return { ok: true, tenantId: input.claims.tenantId, role: input.claims.role, via: "app_metadata" };
  }
  if (input.membership) {
    return { ok: true, tenantId: input.membership.tenantId, role: input.membership.role, via: "membership" };
  }
  const email = input.claims.email.toLowerCase();
  if (bootstrapEnabled(env) && email && bootstrapEmails(env).includes(email)) {
    return { ok: true, tenantId: defaultTenantId(env), role: "ADMIN", via: "bootstrap" };
  }
  return {
    ok: false,
    code: "TENANT_UNASSIGNED",
    message:
      "This Supabase user has no tenant. Set app_metadata.tenant_id from the server, add a membership, or bootstrap an explicit admin email. user_metadata is ignored.",
  };
}

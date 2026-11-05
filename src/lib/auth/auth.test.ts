import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, importJWK, SignJWT } from "jose";
import { describe, it } from "node:test";

import { authenticateRequest } from "@/lib/auth/authenticate";
import { decideTenant, readAccessClaims } from "@/lib/auth/claims";
import { describeAuthConfig } from "@/lib/auth/config";
import { signSessionToken, verifySessionToken, verifySupabaseAccessToken } from "@/lib/auth/jwt";

const SECRET = "test-supabase-jwt-secret-32chars-min";
const SESSION = "jarvis-session-secret-must-be-32-characters";

const env = {
  AUTH_JWT_ISSUER: "https://example.supabase.co/auth/v1",
  AUTH_JWT_AUDIENCE: "authenticated",
  SUPABASE_JWT_SECRET: SECRET,
  JARVIS_SESSION_SECRET: SESSION,
  NODE_ENV: "test",
} as NodeJS.ProcessEnv;

async function accessToken(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(claims.sub ?? "user-1"))
    .setIssuer(env.AUTH_JWT_ISSUER!)
    .setAudience("authenticated")
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(SECRET));
}

describe("shared Zar Labs identity", () => {
  it("does not treat an anon key as a logged-in session", () => {
    const status = describeAuthConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);
    assert.equal(status.verifierReady, true);
    assert.equal(status.browserSessionReady, false);
    assert.match(status.detail, /not a session/i);
  });

  it("rejects user_metadata tenant and role, and accepts app_metadata", async () => {
    const token = await accessToken({
      sub: "user-1",
      email: "owner@zarlabs.online",
      app_metadata: { tenant_id: "tenant_zar_labs", role: "ADMIN" },
      user_metadata: { tenant_id: "tenant_attacker", role: "ADMIN" },
    });
    const payload = await verifySupabaseAccessToken(token, env);
    const claims = readAccessClaims(payload);
    assert.equal(claims.tenantId, "tenant_zar_labs");
    assert.equal(claims.role, "ADMIN");
    const decision = decideTenant({ claims, membership: null, env });
    assert.equal(decision.ok && decision.tenantId, "tenant_zar_labs");
  });

  it("does not let a caller bootstrap a tenant from user_metadata", () => {
    const decision = decideTenant({
      claims: { sub: "user-2", email: "person@example.com", role: "OPERATOR", tenantId: null },
      membership: null,
      env: { ...env, JARVIS_BOOTSTRAP_TENANT: "true", JARVIS_BOOTSTRAP_ADMIN_EMAILS: "owner@zarlabs.online" },
    });
    assert.equal(decision.ok, false);
  });

  it("rejects a bad audience and an expired token", async () => {
    const wrongAudience = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuer(env.AUTH_JWT_ISSUER!)
      .setAudience("anon")
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(SECRET));
    await assert.rejects(() => verifySupabaseAccessToken(wrongAudience, env));
    const expired = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuer(env.AUTH_JWT_ISSUER!)
      .setAudience("authenticated")
      .setExpirationTime("-1s")
      .sign(new TextEncoder().encode(SECRET));
    await assert.rejects(() => verifySupabaseAccessToken(expired, env));
  });

  it("authenticates a bearer token and ignores a body user id", async () => {
    const token = await accessToken({
      sub: "user-9",
      email: "owner@zarlabs.online",
      app_metadata: { tenant_id: "tenant_acme" },
    });
    const request = new Request("https://jarvis.example/api/v1/leads", {
      headers: { authorization: `Bearer ${token}` },
    });
    const result = await authenticateRequest(request, { env, lookupMembership: async () => null });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.principal.sub, "user-9");
      assert.equal(result.principal.tenantId, "tenant_acme");
      assert.equal(result.principal.scope, "tenant");
    }
  });

  it("round-trips a session cookie and rejects a tampered tenant", async () => {
    const token = await signSessionToken(
      { sub: "user-1", email: "a@b.c", role: "OPERATOR", tenantId: "tenant_zar_labs", source: "session" },
      env,
    );
    const principal = await verifySessionToken(token, env);
    assert.equal(principal.tenantId, "tenant_zar_labs");
    const [head, body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    payload.tenantId = "tenant_other";
    const tampered = `${head}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    await assert.rejects(() => verifySessionToken(tampered, env));
  });

  it("verifies an asymmetric token with a local JWKS", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const imported = await importJWK(jwk, "RS256");
    const { createLocalJWKSet } = await import("jose");
    const jwks = createLocalJWKSet({ keys: [{ ...jwk, alg: "RS256", kid: "test", use: "sig" }] });
    const token = await new SignJWT({ email: "owner@zarlabs.online", app_metadata: { tenant_id: "tenant_zar_labs" } })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject("user-rs")
      .setIssuer(env.AUTH_JWT_ISSUER!)
      .setAudience("authenticated")
      .setExpirationTime("10m")
      .sign(privateKey);
    const payload = await verifySupabaseAccessToken(token, { ...env, SUPABASE_JWT_SECRET: "" }, { jwks });
    assert.equal(payload.sub, "user-rs");
    void imported;
  });
});

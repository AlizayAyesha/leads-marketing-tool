import { ACCESS_AUDIENCE, DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG } from "@/lib/auth/constants";

export type AuthVerifier = "jwks" | "hmac" | "jwks+hmac" | "missing";

export type AuthConfigStatus = {
  /** True only when a JWT can be verified. Anon-key presence is not enough. */
  verifierReady: boolean;
  browserSessionReady: boolean;
  verifier: AuthVerifier;
  issuer: string;
  audience: string;
  anonKeyPresent: boolean;
  serviceRolePresent: boolean;
  /** The service role key is never sent to the browser by this service. */
  serviceRoleExposedToClient: false;
  enforcement: "required" | "open";
  devSessionEnabled: boolean;
  detail: string;
};

export function supabaseIssuer(env: NodeJS.ProcessEnv = process.env) {
  const explicit = env.AUTH_JWT_ISSUER?.trim() || "";
  if (explicit) return explicit.replace(/\/$/, "");
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  if (!url) return "";
  return `${url.replace(/\/$/, "")}/auth/v1`;
}

export function authAudience(env: NodeJS.ProcessEnv = process.env) {
  return env.AUTH_JWT_AUDIENCE?.trim() || ACCESS_AUDIENCE;
}

export function defaultTenantId(env: NodeJS.ProcessEnv = process.env) {
  return env.JARVIS_DEFAULT_TENANT_ID?.trim() || DEFAULT_TENANT_ID;
}

export function defaultTenantSlug(env: NodeJS.ProcessEnv = process.env) {
  return env.JARVIS_DEFAULT_TENANT_SLUG?.trim() || DEFAULT_TENANT_SLUG;
}

export function authEnforcement(env: NodeJS.ProcessEnv = process.env): "required" | "open" {
  if (env.NEXT_PHASE === "phase-production-build") return "open";
  if (env.NODE_ENV === "production") return "required";
  if (env.JARVIS_ENFORCE_AUTH === "false") return "open";
  if (env.JARVIS_ENFORCE_AUTH === "true" || env.DEV_AUTH_ENABLED === "true") return "required";
  return "open";
}

export function devSessionEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== "production" && env.DEV_AUTH_ENABLED === "true";
}

export function describeAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfigStatus {
  const issuer = supabaseIssuer(env);
  const hmac = Boolean(env.SUPABASE_JWT_SECRET?.trim());
  const session = Boolean(env.JARVIS_SESSION_SECRET?.trim());
  let verifier: AuthVerifier = "missing";
  if (issuer && hmac) verifier = "jwks+hmac";
  else if (issuer) verifier = "jwks";
  else if (hmac) verifier = "hmac";
  const verifierReady = verifier !== "missing";
  const enforcement = authEnforcement(env);
  const detail = verifierReady
    ? `Supabase access tokens are verified (${verifier}, audience ${authAudience(env)}). A present anon key is not a session. Browser cookies also need JARVIS_SESSION_SECRET${session ? " (set)." : " (missing)."}`
    : "Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL or AUTH_JWT_ISSUER so the issuer is <project>/auth/v1, plus JARVIS_SESSION_SECRET. Legacy HS256 projects also need SUPABASE_JWT_SECRET. The anon key does not authenticate anyone.";
  return {
    verifierReady,
    browserSessionReady: verifierReady && session,
    verifier,
    issuer,
    audience: authAudience(env),
    anonKeyPresent: Boolean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()),
    serviceRolePresent: Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    serviceRoleExposedToClient: false,
    enforcement,
    devSessionEnabled: devSessionEnabled(env),
    detail,
  };
}

export function bootstrapEmails(env: NodeJS.ProcessEnv = process.env) {
  return (env.JARVIS_BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function bootstrapEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.JARVIS_BOOTSTRAP_TENANT === "true";
}

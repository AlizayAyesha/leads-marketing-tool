export type OperatorRole = "ADMIN" | "OPERATOR";

export type Principal = {
  sub: string;
  email: string;
  role: OperatorRole;
  tenantId: string;
  /** session = Jarvis cookie minted from a verified Supabase token. bearer = the Supabase token itself. */
  source: "session" | "bearer" | "dev" | "worker";
  /** worker ticks may see every tenant. Everyone else is limited to tenantId. */
  scope: "tenant" | "all";
};

export type AccessClaims = {
  sub: string;
  email: string;
  role: OperatorRole;
  tenantId: string | null;
  issuer: string;
  audience: string[];
};

export type AuthErrorBody = {
  error: {
    code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "TENANT_UNASSIGNED"
      | "AUTH_NOT_CONFIGURED"
      | "INVALID_TOKEN";
    message: string;
  };
};

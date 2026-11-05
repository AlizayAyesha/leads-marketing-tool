import { NextResponse } from "next/server";

import { authenticateRequest, sessionClearCookie, sessionSetCookie, type AuthenticateDeps } from "@/lib/auth/authenticate";
import { principalStorage } from "@/lib/auth/context";
import { defaultTenantId } from "@/lib/auth/config";
import type { Principal } from "@/lib/auth/types";
import { isQueueRequestAuthorized } from "@/lib/queue/auth";

async function defaultLookup(sub: string) {
  const { prisma } = await import("@/lib/db/prisma");
  const row = await prisma.membership.findFirst({
    where: { supabaseUserId: sub },
    orderBy: { createdAt: "asc" },
  });
  return row ? { tenantId: row.tenantId, role: row.role } : null;
}

export function workerPrincipal(): Principal {
  return {
    sub: "worker",
    email: "",
    role: "ADMIN",
    tenantId: defaultTenantId(),
    source: "worker",
    scope: "all",
  };
}

export async function authenticateHttp(request: Request, deps?: Partial<AuthenticateDeps>) {
  return authenticateRequest(request, {
    env: deps?.env ?? process.env,
    lookupMembership: deps?.lookupMembership ?? defaultLookup,
    verifyAccessToken: deps?.verifyAccessToken,
  });
}

export function withUser<C = unknown>(
  handler: (request: Request, principal: Principal, context: C) => Promise<Response>,
) {
  return async (request: Request, context: C) => {
    const result = await authenticateHttp(request);
    if (!result.ok) return NextResponse.json(result.body, { status: result.status });
    return principalStorage.run(result.principal, () => handler(request, result.principal, context));
  };
}

export function withQueueSecret(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    if (!isQueueRequestAuthorized(request)) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Worker secret required. A status read cannot run the queue." } },
        { status: 401 },
      );
    }
    return principalStorage.run(workerPrincipal(), () => handler(request));
  };
}

export { sessionSetCookie, sessionClearCookie };

import { NextResponse } from "next/server";

import { devSessionEnabled, defaultTenantId } from "@/lib/auth/config";
import { sessionSetCookie } from "@/lib/auth/http";
import { signSessionToken } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import type { Principal } from "@/lib/auth/types";

export const auth = "public";

export async function POST(request: Request) {
  if (!devSessionEnabled()) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = (body.email || process.env.JARVIS_DEV_OPERATOR_EMAIL || "operator@localhost").trim().toLowerCase();
  const principal: Principal = {
    sub: `dev:${email}`,
    email,
    role: "ADMIN",
    tenantId: defaultTenantId(),
    source: "dev",
    scope: "tenant",
  };
  await prisma.tenant.upsert({
    where: { id: principal.tenantId },
    update: {},
    create: { id: principal.tenantId, slug: "zar-labs", name: "Zar Labs" },
  });
  await prisma.membership.upsert({
    where: { tenantId_supabaseUserId: { tenantId: principal.tenantId, supabaseUserId: principal.sub } },
    update: { email, role: "ADMIN" },
    create: { tenantId: principal.tenantId, supabaseUserId: principal.sub, email, role: "ADMIN" },
  });
  let token: string;
  try {
    token = await signSessionToken(principal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Session secret is not configured.";
    return NextResponse.json({ error: { code: "AUTH_NOT_CONFIGURED", message } }, { status: 503 });
  }
  const response = NextResponse.json({
    principal,
    contractVersion: "1",
    notice: "Development operator session. This is not available in production and is not a second account system.",
  });
  response.headers.append("Set-Cookie", sessionSetCookie(token));
  return response;
}

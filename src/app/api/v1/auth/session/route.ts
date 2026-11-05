import { NextResponse } from "next/server";

import { authenticateHttp, sessionClearCookie, sessionSetCookie } from "@/lib/auth/http";
import { principalStorage } from "@/lib/auth/context";
import { signSessionToken } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import type { Principal } from "@/lib/auth/types";

export const auth = "public";

async function remember(principal: Principal) {
  await prisma.tenant.upsert({
    where: { id: principal.tenantId },
    update: {},
    create: { id: principal.tenantId, slug: principal.tenantId, name: principal.tenantId },
  });
  await prisma.membership.upsert({
    where: { tenantId_supabaseUserId: { tenantId: principal.tenantId, supabaseUserId: principal.sub } },
    update: { email: principal.email, role: principal.role },
    create: {
      tenantId: principal.tenantId,
      supabaseUserId: principal.sub,
      email: principal.email,
      role: principal.role,
    },
  });
  if (principal.email) {
    await prisma.user.upsert({
      where: { email: principal.email },
      update: { supabaseUserId: principal.sub, role: principal.role },
      create: { email: principal.email, supabaseUserId: principal.sub, role: principal.role, name: principal.email },
    });
  }
}

export async function GET(request: Request) {
  const result = await authenticateHttp(request);
  if (!result.ok) return NextResponse.json(result.body, { status: result.status });
  return NextResponse.json({ principal: result.principal });
}

export async function POST(request: Request) {
  const result = await authenticateHttp(request);
  if (!result.ok) return NextResponse.json(result.body, { status: result.status });
  try {
    await principalStorage.run(result.principal, () => remember(result.principal));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not store membership.";
    return NextResponse.json({ error: { code: "MEMBERSHIP_FAILED", message } }, { status: 503 });
  }
  let token: string;
  try {
    token = await signSessionToken(result.principal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Session secret is not configured.";
    return NextResponse.json({ error: { code: "AUTH_NOT_CONFIGURED", message } }, { status: 503 });
  }
  const body = { principal: result.principal, contractVersion: "1" };
  const response = NextResponse.json(body);
  response.headers.append("Set-Cookie", sessionSetCookie(token));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.headers.append("Set-Cookie", sessionClearCookie());
  return response;
}

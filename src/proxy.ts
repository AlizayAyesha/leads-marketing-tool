import { NextResponse, type NextRequest } from "next/server";

import { authEnforcement } from "@/lib/auth/config";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { verifySessionToken } from "@/lib/auth/jwt";

const PUBLIC_PREFIXES = [
  "/signin",
  "/api/v1/health",
  "/api/v1/auth/session",
  "/api/v1/auth/dev-session",
  "/api/v1/unsubscribe",
  "/api/v1/webhooks/email-events",
  "/api/v1/worker/tick",
  "/api/queue/process",
  "/api/google/callback",
  "/go/",
];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
  if (authEnforcement() !== "required") return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.startsWith("/images")) {
    return NextResponse.next();
  }
  if (isPublic(pathname)) return NextResponse.next();

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (bearer) return NextResponse.next();
  if (cookie) {
    try {
      await verifySessionToken(cookie);
      return NextResponse.next();
    } catch {
      // fall through
    }
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in through Zar Labs. This route does not accept a client-supplied user id." } },
      { status: 401 },
    );
  }
  const next = request.nextUrl.clone();
  next.pathname = "/signin";
  next.searchParams.set("next", pathname);
  return NextResponse.redirect(next);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextResponse } from "next/server";

import { principalStorage } from "@/lib/auth/context";
import { readOAuthState } from "@/lib/auth/oauth-state";
import type { Principal } from "@/lib/auth/types";
import { storeGoogleTokens } from "@/lib/data-sources/google";
import { storeSenderAccountFromCode } from "@/lib/outreach/sender-accounts";

export const auth = "public";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const secret = process.env.JARVIS_SESSION_SECRET?.trim() || "";
  const state = readOAuthState(url.searchParams.get("state"), secret);
  if (!code || !state) {
    return NextResponse.redirect(new URL("/integrations/sheets?google=invalid_state", url.origin));
  }
  const principal: Principal = {
    sub: state.sub || "oauth",
    email: "",
    role: "OPERATOR",
    tenantId: state.tenantId,
    source: "session",
    scope: "tenant",
  };
  return principalStorage.run(principal, async () => {
    if (state.kind === "sender") {
      try {
        await storeSenderAccountFromCode(code);
        return NextResponse.redirect(new URL("/settings/senders?connected=1", url.origin));
      } catch (error) {
        const message = error instanceof Error ? error.message : "oauth_failed";
        return NextResponse.redirect(new URL(`/settings/senders?error=${encodeURIComponent(message)}`, url.origin));
      }
    }
    try {
      await storeGoogleTokens(code);
      if (state.kind === "outreach") {
        return NextResponse.redirect(new URL("/?connect=linkedin", url.origin));
      }
      return NextResponse.redirect(new URL("/integrations/sheets?google=connected", url.origin));
    } catch (error) {
      const message = error instanceof Error ? error.message : "oauth_failed";
      const errorPath =
        state.kind === "outreach"
          ? `/?connect=linkedin&google=error&detail=${encodeURIComponent(message)}`
          : `/integrations/sheets?google=error&detail=${encodeURIComponent(message)}`;
      return NextResponse.redirect(new URL(errorPath, url.origin));
    }
  });
}

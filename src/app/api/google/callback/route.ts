import { NextResponse } from "next/server";

import { storeGoogleTokens } from "@/lib/data-sources/google";
import { storeSenderAccountFromCode } from "@/lib/outreach/sender-accounts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) {
    return NextResponse.redirect(new URL("/integrations/sheets?google=missing_code", url.origin));
  }
  if (state === "sender") {
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
    if (state === "outreach") {
      return NextResponse.redirect(new URL("/?connect=linkedin", url.origin));
    }
    return NextResponse.redirect(new URL("/integrations/sheets?google=connected", url.origin));
  } catch (error) {
    const message = error instanceof Error ? error.message : "oauth_failed";
    const errorPath =
      state === "outreach"
        ? `/?connect=linkedin&google=error&detail=${encodeURIComponent(message)}`
        : `/integrations/sheets?google=error&detail=${encodeURIComponent(message)}`;
    return NextResponse.redirect(new URL(errorPath, url.origin));
  }
}

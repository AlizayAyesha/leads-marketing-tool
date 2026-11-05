import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/http";
import { signOAuthState } from "@/lib/auth/oauth-state";
import { googleAuthUrl } from "@/lib/data-sources/google";
import { IntegrationPendingError } from "@/lib/data-sources/types";

export const GET = withUser(async (request, principal) => {
  const secret = process.env.JARVIS_SESSION_SECRET?.trim() || "";
  if (secret.length < 32) {
    return NextResponse.json(
      { error: { code: "AUTH_NOT_CONFIGURED", message: "JARVIS_SESSION_SECRET is required before Google OAuth can be bound to a tenant." } },
      { status: 503 },
    );
  }
  try {
    const url = new URL(request.url);
    const gmailOutreach = url.searchParams.get("gmail") === "1";
    const next = url.searchParams.get("next");
    const kind = url.searchParams.get("sender") === "1" ? "sender" : next === "outreach" ? "outreach" : "sheets";
    const state = signOAuthState({ kind, tenantId: principal.tenantId, sub: principal.sub }, secret);
    return NextResponse.redirect(
      googleAuthUrl({
        gmailOutreach: gmailOutreach || kind === "sender",
        senderOnly: kind === "sender",
        state,
      }),
    );
  } catch (error) {
    const message = error instanceof IntegrationPendingError ? error.message : "Google OAuth is not available.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
});

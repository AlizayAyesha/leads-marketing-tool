import { NextResponse } from "next/server";

import { googleAuthUrl } from "@/lib/data-sources/google";
import { IntegrationPendingError } from "@/lib/data-sources/types";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const gmailOutreach = url.searchParams.get("gmail") === "1";
    const next = url.searchParams.get("next");
    // ?sender=1 connects an additional Gmail sender inbox (Settings → Sender inboxes).
    if (url.searchParams.get("sender") === "1") {
      return NextResponse.redirect(googleAuthUrl({ senderOnly: true, state: "sender" }));
    }
    const state = next === "outreach" ? "outreach" : undefined;
    return NextResponse.redirect(googleAuthUrl({ gmailOutreach, state }));
  } catch (error) {
    const message =
      error instanceof IntegrationPendingError
        ? error.message
        : "Google OAuth is not available.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/http";
import { evaluateSenderConfiguration, evaluateDomainAuthentication } from "@/lib/outreach/sender-config";

export const GET = withUser(async () => {
  const sender = evaluateSenderConfiguration();
  return NextResponse.json({
    sender,
    domain: evaluateDomainAuthentication({
      fromEmail: sender.fromEmail,
      lookedUp: false,
    }),
  });
});

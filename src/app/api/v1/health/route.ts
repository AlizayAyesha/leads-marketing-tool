import { NextResponse } from "next/server";

import { describeAuthConfig } from "@/lib/auth/config";
import { billingStatus } from "@/lib/billing/status";
import { evaluateSenderConfiguration } from "@/lib/outreach/sender-config";

export const auth = "public";

export function GET() {
  const authConfig = describeAuthConfig();
  const billing = billingStatus();
  const sender = evaluateSenderConfiguration();
  return NextResponse.json({
    ok: true,
    service: "jarvis",
    contractVersion: "1",
    auth: {
      verifierReady: authConfig.verifierReady,
      verifier: authConfig.verifier,
      issuer: authConfig.issuer,
      audience: authConfig.audience,
      enforcement: authConfig.enforcement,
      browserSessionReady: authConfig.browserSessionReady,
    },
    sending: {
      senderReady: sender.readyForProductionSend,
      blockCode: sender.blockCode,
      oneClickUnsubscribe: sender.httpsAppUrl && sender.unsubscribeConfigured,
    },
    billing: {
      chargesEnabled: billing.chargesEnabled,
      provider: billing.provider,
      ledger: billing.ledger,
    },
  });
}

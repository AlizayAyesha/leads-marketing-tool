import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/http";
import { usageSummary } from "@/lib/billing/ledger";
import { getOutreachEnginePolicy } from "@/lib/outreach/sequence";

export const GET = withUser(async (_request, principal) => {
  const [usage, policy] = await Promise.all([usageSummary(principal.tenantId), getOutreachEnginePolicy()]);
  return NextResponse.json({
    usage,
    limit: policy.dailySendLimit,
    chargesEnabled: false,
  });
});

import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/http";
import { getOutreachEnginePolicy } from "@/lib/outreach/sequence";

export const GET = withUser(async () => {
  const policy = await getOutreachEnginePolicy();
  return NextResponse.json({
    sendsPaused: policy.sendsPaused,
    sendMode: policy.sendMode,
    dailySendLimit: policy.dailySendLimit,
    emailEnabled: policy.emailEnabled,
    linkedinDailyOutreach: policy.linkedinDailyOutreach,
    twitterDailyOutreach: policy.twitterDailyOutreach,
    note: "Reading this policy does not approve or send.",
  });
});

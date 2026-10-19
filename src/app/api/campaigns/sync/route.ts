import { NextResponse } from "next/server";

import { syncCampaignRun } from "@/lib/campaigns/runner";

export async function POST(request: Request) {
  const body = (await request.json()) as { campaignRunId?: string };
  if (!body.campaignRunId) {
    return NextResponse.json({ error: "campaignRunId is required" }, { status: 400 });
  }
  const result = await syncCampaignRun(body.campaignRunId);
  return NextResponse.json(result);
}

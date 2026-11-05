import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/http";
import { interpretCommand } from "@/lib/agents/orchestrator";

export const POST = withUser(async (request) => {
  const body = (await request.json()) as { command?: string };
  const result = await interpretCommand(body.command ?? "");
  return NextResponse.json(result);
});

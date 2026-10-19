import { NextResponse } from "next/server";

import { interpretCommand } from "@/lib/agents/orchestrator";

export async function POST(request: Request) {
  const body = (await request.json()) as { command?: string };
  const result = await interpretCommand(body.command ?? "");
  return NextResponse.json(result);
}

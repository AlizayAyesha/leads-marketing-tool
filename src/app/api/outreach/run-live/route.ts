import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/http";
import { runLiveOutreach } from "@/lib/outreach/run-live";

export const POST = withUser(async () => {
  try {
    const report = await runLiveOutreach({ importSheet: true });
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Use POST. GET cannot start outreach." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

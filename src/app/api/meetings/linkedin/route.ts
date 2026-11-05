import { NextRequest, NextResponse } from "next/server";

import { authenticateHttp } from "@/lib/auth/http";
import { principalStorage } from "@/lib/auth/context";
import { meetingParamsFromSchedulerBody } from "@/lib/conversation/booking";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await authenticateHttp(request);
  if (!authResult.ok) return NextResponse.json(authResult.body, { status: authResult.status });
  return principalStorage.run(authResult.principal, async () => {
  const body = (await request.json().catch(() => ({}))) as unknown;
  const parsed = meetingParamsFromSchedulerBody(body);
  if (parsed.event === "ignored" || parsed.event === "canceled") {
    return NextResponse.json({ ok: true, ignored: true, event: parsed.event });
  }
  const { recordLinkedInCtaClick, recordLinkedInMeetingBooked } = await import("@/lib/conversation/tracking");
  const result =
    parsed.event === "clicked"
      ? await recordLinkedInCtaClick(parsed.params)
      : await recordLinkedInMeetingBooked(parsed.params);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
  });
}

export async function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "GET does not record a meeting or send." } },
    { status: 405, headers: { Allow: "POST" } },
  );
}

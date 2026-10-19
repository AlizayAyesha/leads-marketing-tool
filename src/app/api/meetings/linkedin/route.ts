import { NextRequest, NextResponse } from "next/server";

import { meetingParamsFromSchedulerBody } from "@/lib/conversation/booking";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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
}

export async function GET(request: NextRequest) {
  const event = request.nextUrl.searchParams.get("event") || "clicked";
  const { recordLinkedInCtaClick, recordLinkedInMeetingBooked } = await import("@/lib/conversation/tracking");
  const result =
    event === "booked"
      ? await recordLinkedInMeetingBooked(request.nextUrl.searchParams)
      : await recordLinkedInCtaClick(request.nextUrl.searchParams);
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}

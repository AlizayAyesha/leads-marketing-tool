import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { recordLinkedInCtaClick, linkedInCtaRedirectUrl } = await import("@/lib/conversation/tracking");
  const { getOutreachEnginePolicy } = await import("@/lib/outreach/sequence");
  await recordLinkedInCtaClick(request.nextUrl.searchParams);
  const policy = await getOutreachEnginePolicy().catch(() => null);
  const dest = await linkedInCtaRedirectUrl(request.nextUrl.searchParams, policy?.bookingUrl);
  if (dest) return NextResponse.redirect(dest, 302);
  return new NextResponse(
    "Thanks — your LinkedIn meeting request is tagged source=linkedin. We'll confirm the time shortly.",
    { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

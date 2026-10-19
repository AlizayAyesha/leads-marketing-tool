import { getBusinessProfile } from "@/lib/business/profile";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public booking hop: <APP_URL>/go/website
 * Records attribution then 302s to the configured scheduler / contact page.
 */
export async function GET(request: NextRequest) {
  const { recordWebsiteCtaClick, websiteCtaRedirectUrl } = await import("@/lib/conversation/tracking");
  const { getOutreachEnginePolicy } = await import("@/lib/outreach/sequence");
  await recordWebsiteCtaClick(request.nextUrl.searchParams);
  const policy = await getOutreachEnginePolicy().catch(() => null);
  const dest = await websiteCtaRedirectUrl(request.nextUrl.searchParams, policy?.bookingUrl);
  if (dest) return NextResponse.redirect(dest, 302);
  return NextResponse.redirect((getBusinessProfile().website || "http://localhost:3000"), 302);
}

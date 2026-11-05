import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/http";
import { openaiVoiceConfigured } from "@/lib/jarvis/voice";

export const dynamic = "force-dynamic";

export const GET = withUser(async () => {
  const openai = await openaiVoiceConfigured().catch(() => false);
  return NextResponse.json({ openai, sends: false });
});

import { NextResponse } from "next/server";

import { openaiVoiceConfigured } from "@/lib/jarvis/voice";

export const dynamic = "force-dynamic";

export async function GET() {
  const openai = await openaiVoiceConfigured().catch(() => false);
  return NextResponse.json({ openai });
}

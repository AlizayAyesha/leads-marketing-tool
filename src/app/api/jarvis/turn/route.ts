import { NextResponse } from "next/server";

import { jarvisBrainTurn } from "@/lib/jarvis/brain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as { message?: string; threadId?: string };
  try {
    const turn = await jarvisBrainTurn({ message: body.message ?? "", threadId: body.threadId });
    return NextResponse.json(turn);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Jarvis turn failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

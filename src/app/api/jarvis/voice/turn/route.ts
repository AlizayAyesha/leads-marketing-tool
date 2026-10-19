import { NextResponse } from "next/server";

import { runJarvisVoiceTurn } from "@/lib/jarvis/voice";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const text = String(form.get("text") ?? "").trim();
  const speak = String(form.get("speak") ?? "true") !== "false";
  const file = form.get("audio");

  let audio: { buffer: Buffer; filename: string; mime: string } | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "Audio clip is too long. Keep it under 30 seconds." }, { status: 413 });
    }
    audio = {
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name || "speech.webm",
      mime: file.type || "audio/webm",
    };
  }

  try {
    const turn = await runJarvisVoiceTurn({
      text: text || undefined,
      audio,
      speak,
      threadId: String(form.get("threadId") ?? "").trim() || null,
    });
    return NextResponse.json(turn);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voice turn failed.";
    const status = /not configured/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

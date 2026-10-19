import { NextResponse } from "next/server";

import { enqueue, processQueue } from "@/lib/queue/engine";

export async function GET() {
  await enqueue({ type: "IMPORT_SHEET" });
  await processQueue(1);
  return NextResponse.redirect(new URL("/settings?sheets=imported", process.env.APP_URL || "http://localhost:3000"));
}

export async function POST() {
  const task = await enqueue({ type: "IMPORT_SHEET" });
  await processQueue(1);
  return NextResponse.json({ taskId: task.id });
}

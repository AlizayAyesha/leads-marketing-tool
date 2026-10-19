import { NextResponse } from "next/server";

import { enqueue, processQueue } from "@/lib/queue/engine";

export async function GET() {
  await enqueue({ type: "EXPORT_SHEET" });
  await processQueue(1);
  return NextResponse.redirect(new URL("/settings?sheets=exported", process.env.APP_URL || "http://localhost:3000"));
}

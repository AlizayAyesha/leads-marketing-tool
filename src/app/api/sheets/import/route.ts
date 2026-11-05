import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/http";
import { enqueue, processQueue } from "@/lib/queue/engine";

export function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "GET does not import or send. Use POST." } },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export const POST = withUser(async () => {
  const task = await enqueue({ type: "IMPORT_SHEET" });
  await processQueue(1);
  return NextResponse.json({ taskId: task.id, sent: false });
});

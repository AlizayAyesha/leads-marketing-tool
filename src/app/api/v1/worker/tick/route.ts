import { NextResponse } from "next/server";

import { withQueueSecret } from "@/lib/auth/http";
import { runWorkerTick } from "@/lib/queue/worker-tick";

export const auth = "worker";

export function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "GET does not run the worker or send mail." } },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export const POST = withQueueSecret(async () => {
  const report = await runWorkerTick();
  return NextResponse.json({ ok: true, ...report, results: report.results.map((item) => ({ id: item.id, status: item.status })) });
});

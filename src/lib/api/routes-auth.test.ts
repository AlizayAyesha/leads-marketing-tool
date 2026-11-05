import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

describe("API routes require a real principal or an explicit public marker", () => {
  const files = walk(join(process.cwd(), "src/app/api"));

  it("covers every route handler", () => {
    const missing = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return !(
        /withUser\(|withQueueSecret\(|authenticateHttp\(|export const auth = "public"/.test(text) ||
        text.includes('from "@/lib/api/v1-handlers"')
      );
    });
    assert.deepEqual(missing, []);
  });

  it("does not process the queue from GET", () => {
    const queue = readFileSync(join(process.cwd(), "src/app/api/queue/process/route.ts"), "utf8");
    const getBlock = queue.slice(queue.indexOf("export async function GET"), queue.indexOf("export const POST"));
    assert.equal(getBlock.includes("processQueue"), false);
    assert.match(getBlock, /queueStatus/);
    const worker = readFileSync(join(process.cwd(), "src/app/api/v1/worker/tick/route.ts"), "utf8");
    assert.match(worker, /GET does not run the worker/);
  });
});

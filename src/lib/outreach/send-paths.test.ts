import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function rel(file: string) {
  return relative(process.cwd(), file).replaceAll("\\", "/");
}

describe("production send paths", () => {
  const files = walk(ROOT);
  const gmailCallers: string[] = [];
  const approvedDraftCallers: string[] = [];

  for (const file of files) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const text = readFileSync(file, "utf8");
    const path = rel(file);
    if (text.includes("sendGmailMessage")) gmailCallers.push(path);
    if (text.includes("sendApprovedDraft")) approvedDraftCallers.push(path);
  }

  it("does not let app/API/queue call sendGmailMessage except transport + test-transport", () => {
    const allowed = new Set([
      "src/lib/outreach/send.ts",
      "src/lib/outreach/test-transport-send.ts",
    ]);
    const extra = gmailCallers.filter((file) => !allowed.has(file));
    assert.deepEqual(extra, [], `Unexpected sendGmailMessage callers: ${extra.join(", ")}`);
  });

  it("routes UI, Jarvis, cadence auto-send, and approve-to-send through sendApprovedDraft", () => {
    assert.ok(approvedDraftCallers.includes("src/lib/outreach/send.ts"));
    assert.ok(approvedDraftCallers.includes("src/lib/actions/outreach.ts"));
    assert.ok(approvedDraftCallers.includes("src/lib/outreach/engine.ts"));
    assert.ok(approvedDraftCallers.includes("src/lib/jarvis/tools.ts"));
    const apiHits = files.filter((file) => file.includes("/app/api/") && readFileSync(file, "utf8").includes("sendGmailMessage"));
    assert.equal(apiHits.length, 0);
  });

  it("API live outreach and queue do not import Gmail transport", () => {
    const live = readFileSync(join(ROOT, "app/api/outreach/run-live/route.ts"), "utf8");
    const queue = readFileSync(join(ROOT, "app/api/queue/process/route.ts"), "utf8");
    const jarvis = readFileSync(join(ROOT, "app/api/jarvis/turn/route.ts"), "utf8");
    assert.equal(live.includes("sendGmailMessage"), false);
    assert.equal(queue.includes("sendGmailMessage"), false);
    assert.equal(jarvis.includes("sendGmailMessage"), false);
    assert.match(live, /runLiveOutreach/);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { resolveAIConfig, DEFAULT_MODELS } from "@/lib/ai/config";
import { composeContentDraft, parseContentModelJson, buildContentMessages } from "@/lib/content/compose";
import { loadPlaybook } from "@/lib/content/playbook";
import {
  CONTENT_AGENT_SENDS,
  CONTENT_PLATFORMS,
  decideContentDraft,
  parseContentRequest,
} from "@/lib/content/platforms";

const business = {
  businessName: "Acme Studio",
  description: "Sites and booking for clinics.",
  services: ["website redesign"],
  website: "https://acme.example",
  bookingUrl: "",
};

describe("growth playbooks", () => {
  it("loads seven MIT playbooks and keeps attribution", () => {
    const expected: Record<string, string[]> = {
      X: ["sergebulaev/x-skills", "Sergey Bulaev"],
      LINKEDIN: ["sergebulaev/linkedin-skills", "Sergey Bulaev"],
      INSTAGRAM: ["sergebulaev/instagram-skills", "Sergey Bulaev"],
      TIKTOK: ["sergebulaev/tiktok-skills", "Sergey Bulaev"],
      REDDIT: ["1146345502/reddit-skills", "Qingyuan Yang"],
      FACEBOOK: ["sergebulaev/facebook-skills", "Sergey Bulaev"],
      THREADS: ["sergebulaev/threads-skills", "Sergey Bulaev"],
    };
    assert.equal(CONTENT_PLATFORMS.length, 7);
    for (const platform of CONTENT_PLATFORMS) {
      const text = loadPlaybook(platform.id);
      assert.match(text, /^# /);
      for (const line of expected[platform.id]) assert.match(text, new RegExp(line));
    }
    const license = readFileSync(join(process.cwd(), "skills/LICENSE"), "utf8");
    const readme = readFileSync(join(process.cwd(), "skills/README.md"), "utf8");
    assert.match(license, /MIT License/);
    assert.match(license, /Sergey Bulaev/);
    assert.match(license, /Qingyuan Yang/);
    assert.match(readme, /AGPL-3\.0/);
    assert.match(readme, /sergebulaev\/x-skills/);
    assert.match(readme, /sergebulaev\/threads-skills/);
    assert.match(readme, /1146345502\/reddit-skills/);
  });
});

describe("content request", () => {
  it("requires a platform, a kind, and a lead or topic", () => {
    assert.equal(parseContentRequest({ platform: "X", kind: "POST" }).ok, false);
    assert.equal(parseContentRequest({ platform: "NOPE", kind: "POST", topic: "hi" }).ok, false);
    const ok = parseContentRequest({ platform: "LINKEDIN", kind: "DM", topic: "hiring a receptionist" });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.value.leadId, null);
  });

  it("never marks a draft sent", () => {
    assert.equal(CONTENT_AGENT_SENDS, false);
    assert.equal(decideContentDraft("PENDING_APPROVAL", "approve"), "APPROVED");
    assert.equal(decideContentDraft("EDITED", "reject"), "REJECTED");
    assert.equal(decideContentDraft("PENDING_APPROVAL", "edit"), "EDITED");
    assert.throws(() => decideContentDraft("SENT", "approve"), /CONTENT_NEVER_SENDS/);
  });
});

describe("content compose", () => {
  it("puts the playbook in system guidance and drafts on the free-model label", async () => {
    const config = resolveAIConfig({});
    assert.equal(config.provider, "openrouter");
    assert.equal(config.model, DEFAULT_MODELS.openrouter);
    assert.equal(config.model, "openrouter/free");

    const request = parseContentRequest({ platform: "X", kind: "POST", topic: "no online booking" });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const playbook = loadPlaybook("X");
    let sawPlaybook = false;
    const composed = await composeContentDraft(request.value, {
      playbook,
      business,
      lead: null,
      complete: async (messages) => {
        sawPlaybook = messages.system.includes("Hard safety rules") && messages.system.includes(playbook.trim().slice(0, 80));
        assert.match(messages.system, /never post/i);
        assert.match(messages.user, /no online booking/);
        return {
          text: JSON.stringify({
            subject: null,
            message: "Clinics still take bookings by phone.",
            notes: "Human posts this.",
            status: "SENT",
          }),
          provider: config.provider,
          model: config.model,
        };
      },
    });
    assert.equal(sawPlaybook, true);
    assert.equal(composed.status, "PENDING_APPROVAL");
    assert.equal(composed.mode, "ai");
    assert.equal(composed.modelProvider, "openrouter:openrouter/free");
    assert.equal(composed.skillId, "x-growth");
    assert.equal(composed.message, "Clinics still take bookings by phone.");
    const messages = buildContentMessages({ playbook, request: request.value, business, lead: null });
    assert.match(messages.system, /PLAYBOOK:/);
  });

  it("falls back to a heuristic draft when no model answers", async () => {
    const request = parseContentRequest({ platform: "REDDIT", kind: "COMMENT", leadId: "lead-1" });
    assert.equal(request.ok, true);
    if (!request.ok) return;
    const composed = await composeContentDraft(request.value, {
      playbook: loadPlaybook("REDDIT"),
      business,
      lead: {
        id: "lead-1",
        name: "Ada",
        company: "North Clinic",
        industry: "dental",
        location: "Berlin",
        website: "https://north.example",
        notes: null,
        originalPost: null,
      },
      complete: async () => null,
    });
    assert.equal(composed.mode, "heuristic");
    assert.equal(composed.modelProvider, null);
    assert.equal(composed.status, "PENDING_APPROVAL");
    assert.ok(composed.message.length > 20);
  });

  it("parses fenced JSON and rejects empty copy", () => {
    const parsed = parseContentModelJson('```json\n{"subject":"Title","message":"Body","notes":""}\n```');
    assert.equal(parsed?.subject, "Title");
    assert.equal(parsed?.message, "Body");
    assert.equal(parseContentModelJson('{"message":"  "}'), null);
  });
});

describe("content agent source", () => {
  it("has no social send or publish path", () => {
    const run = readFileSync(join(process.cwd(), "src/lib/content/run.ts"), "utf8");
    const actions = readFileSync(join(process.cwd(), "src/lib/actions/content.ts"), "utf8");
    const combined = `${run}\n${actions}`;
    assert.match(run, /PENDING_APPROVAL/);
    assert.doesNotMatch(combined, /sendApprovedDraft|graph\.facebook|api\.twitter|voyager|publishPost|status:\s*"SENT"/);
  });
});

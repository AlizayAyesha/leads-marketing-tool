import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldBlockTwitterColdDm } from "./eligibility";
import { classifyReply } from "@/lib/outreach/replies";

describe("twitter cold DM eligibility", () => {
  it("blocks anyone already DM'd", () => {
    const gate = shouldBlockTwitterColdDm({ alreadyDmSent: true, leadStatus: "NEW" });
    assert.equal(gate.block, true);
    assert.equal(gate.code, "ALREADY_DMED");
  });

  it("blocks people who said no", () => {
    const gate = shouldBlockTwitterColdDm({ negativeReply: true, leadStatus: "NEW" });
    assert.equal(gate.block, true);
    assert.equal(gate.code, "SAID_NO");
  });

  it("blocks CONTACTED / DNC statuses", () => {
    assert.equal(shouldBlockTwitterColdDm({ leadStatus: "CONTACTED" }).block, true);
    assert.equal(shouldBlockTwitterColdDm({ leadStatus: "DO_NOT_CONTACT" }).code, "DNC");
  });

  it("allows a fresh PASS-ready lead", () => {
    assert.equal(shouldBlockTwitterColdDm({ leadStatus: "QUALIFIED", alreadyDmSent: false }).block, false);
  });
});

describe("short no replies", () => {
  it("classifies plain no / nah / nope as do-not-contact", () => {
    for (const text of ["no", "No.", "nah", "nope", "hard pass"]) {
      const classified = classifyReply(text);
      assert.equal(classified.intent, "NOT_INTERESTED", text);
      assert.equal(classified.leadStatus, "DO_NOT_CONTACT", text);
      assert.equal(classified.suppress, true, text);
    }
  });
});

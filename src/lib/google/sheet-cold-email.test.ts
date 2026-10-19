import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isColdEmailReachedOut } from "./sheet-cold-email";

describe("cold email sheet removal evidence", () => {
  it("treats SENT EMAIL cold drafts as reached out", () => {
    assert.equal(
      isColdEmailReachedOut({
        drafts: [{ status: "SENT", channel: "EMAIL", stepKind: "INITIAL" }],
      }),
      true,
    );
  });

  it("does not remove replies, test transport, or LinkedIn-only sends", () => {
    assert.equal(
      isColdEmailReachedOut({
        drafts: [{ status: "SENT", channel: "EMAIL", stepKind: "REPLY" }],
      }),
      false,
    );
    assert.equal(
      isColdEmailReachedOut({
        drafts: [{ status: "SENT", channel: "EMAIL", stepKind: "TEST_TRANSPORT" }],
      }),
      false,
    );
    assert.equal(
      isColdEmailReachedOut({
        drafts: [{ status: "SENT", channel: "LINKEDIN", stepKind: "INITIAL" }],
        events: [{ type: "LINKEDIN_MESSAGE_SENT", channel: "LINKEDIN" }],
      }),
      false,
    );
  });

  it("counts EMAIL SENT events even when draft stepKind is missing", () => {
    assert.equal(
      isColdEmailReachedOut({
        events: [{ type: "SENT", channel: "EMAIL", draftStepKind: null }],
      }),
      true,
    );
  });
});

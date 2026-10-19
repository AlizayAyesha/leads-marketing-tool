import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  availableSenders,
  clampSenderDailyLimit,
  pickSender,
  planAssignments,
  type PoolAccount,
} from "@/lib/outreach/sender-pool";

const acct = (email: string, limit: number, sent = 0, enabled = true): PoolAccount => ({
  id: email, email, dailySendLimit: limit, sentToday: sent, enabled,
});

describe("gmail sender pool", () => {
  it("defaults to 1/day and clamps to the configured max", () => {
    assert.equal(clampSenderDailyLimit(undefined, {}), 1);
    assert.equal(clampSenderDailyLimit("500", {}), 50);
    assert.equal(clampSenderDailyLimit("500", { GMAIL_SENDER_MAX_DAILY_LIMIT: "20" }), 20);
    assert.equal(clampSenderDailyLimit("0", {}), 0);
  });

  it("round-robins across inboxes and respects per-inbox caps", () => {
    const plan = planAssignments([acct("a@x.test", 2), acct("b@x.test", 1), acct("c@x.test", 1)], 10);
    assert.deepEqual(plan, ["a@x.test", "b@x.test", "c@x.test", "a@x.test"]);
  });

  it("skips disabled and capped inboxes; returns null when all are capped", () => {
    const accounts = [acct("a@x.test", 1, 1), acct("b@x.test", 3, 0, false), acct("c@x.test", 1)];
    assert.equal(pickSender(accounts, -1)?.account.email, "c@x.test");
    assert.equal(availableSenders(accounts).length, 1);
    assert.equal(pickSender([acct("a@x.test", 1, 1)], -1), null);
    assert.equal(pickSender([], -1), null);
  });

  it("continues after the cursor", () => {
    const accounts = [acct("a@x.test", 5), acct("b@x.test", 5)];
    assert.equal(pickSender(accounts, 0)?.account.email, "b@x.test");
    assert.equal(pickSender(accounts, 1)?.account.email, "a@x.test");
  });
});

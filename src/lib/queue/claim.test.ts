import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { claimContended, leaseDecision, type LeaseSnapshot } from "@/lib/queue/claim";

const row: LeaseSnapshot = {
  status: "QUEUED",
  attempts: 0,
  maxRetries: 2,
  availableAt: 0,
  leaseOwner: null,
  leaseExpiresAt: null,
};

describe("queue leases", () => {
  it("lets only one worker claim a queued task", () => {
    const result = claimContended(row, ["a", "b"], 1_000);
    assert.deepEqual(result.winners, ["a"]);
    assert.equal(result.task.status, "RUNNING");
    assert.equal(result.task.leaseOwner, "a");
    assert.equal(result.task.attempts, 1);
  });

  it("requeues an expired lease and fails once retries are spent", () => {
    assert.equal(leaseDecision({ ...row, status: "RUNNING", attempts: 1, leaseExpiresAt: 50 }, 100), "retry");
    assert.equal(leaseDecision({ ...row, status: "RUNNING", attempts: 3, leaseExpiresAt: 50 }, 100), "fail");
    assert.equal(leaseDecision({ ...row, status: "RUNNING", attempts: 1, leaseExpiresAt: 500 }, 100), "keep");
  });
});

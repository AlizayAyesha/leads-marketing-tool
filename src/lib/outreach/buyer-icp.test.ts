import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyBuyerRole } from "./buyer-icp";

describe("classifyBuyerRole", () => {
  it("treats non-tech clinic owners as buyers", () => {
    const r = classifyBuyerRole("Owner", "Karachi Dental Clinic");
    assert.equal(r.ok, true);
    assert.equal(r.code, "BUYER");
  });

  it("rejects digital / marketing agency holders", () => {
    const r = classifyBuyerRole("Agency Owner", "Bright Digital Agency");
    assert.equal(r.ok, false);
    assert.equal(r.code, "AGENCY_HOLDER");
  });

  it("rejects software founders as tech peers", () => {
    const r = classifyBuyerRole("Founder & CEO", "Acme AI Labs");
    assert.equal(r.ok, false);
    assert.equal(r.code, "TECH_PEER_COMPANY");
  });

  it("reads founder/company from a LinkedIn connections-list name blob", () => {
    const r = classifyBuyerRole(
      "Muhammad Moiz Sajjad • 1st Founder, Ferrovex | Entrepreneur | Former CEO",
    );
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.code, "BUYER");
  });

  it("still rejects a CTO/software blob from the connections list", () => {
    const r = classifyBuyerRole(
      "Muhammad Tayyab Yamin • 1st CEO/CTO at Titanno (Private) Limited",
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "TECH_PEER_COMPANY");
  });
});

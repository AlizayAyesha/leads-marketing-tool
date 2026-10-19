import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canDraftFiverrResponse, qualifyFiverrRequest } from "./qualify";

describe("Fiverr request qualification", () => {
  it("rejects a $20 HTML fix", () => {
    const q = qualifyFiverrRequest({
      title: "Fix my HTML",
      message: "Please fix my HTML and change the color. Budget $20.",
      budget: "$20",
    });
    assert.equal(q.band, "REJECT");
    assert.equal(canDraftFiverrResponse(q.band), false);
  });

  it("scores a $3k WhatsApp + HubSpot automation as RESPOND", () => {
    const q = qualifyFiverrRequest({
      title: "AI sales automation",
      message:
        "We need you to build an AI sales automation system integrated with HubSpot and WhatsApp. Our team is manually qualifying WhatsApp leads before entering them into the CRM. Looking for a workflow we can run this quarter. Budget $3,000.",
      budgetAmount: 3000,
      buyerName: "Sara",
      location: "Dubai",
    });
    assert.equal(q.band, "RESPOND");
    assert.ok(q.total >= 80);
    assert.equal(q.offerFamily, "AUTOMATION");
    assert.equal(canDraftFiverrResponse(q.band), true);
  });
});

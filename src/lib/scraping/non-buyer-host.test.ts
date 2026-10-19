import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isNonBuyerDiscoveryHost } from "./non-buyer-host";

describe("non-buyer discovery hosts", () => {
  it("rejects PE / deal directories that classify as REJECT junk", () => {
    assert.equal(isNonBuyerDiscoveryHost("https://tracxn.com/d/companies/foo"), true);
    assert.equal(isNonBuyerDiscoveryHost("https://www.privateequityinternational.com/"), true);
    assert.equal(isNonBuyerDiscoveryHost("https://altss.com/investors"), true);
    assert.equal(isNonBuyerDiscoveryHost("https://helsinkidental.fi"), false);
  });

  it("rejects listing portals and social search hits from Karachi villa classifieds", () => {
    assert.equal(isNonBuyerDiscoveryHost("https://www.zameen.com/Homes/Karachi-1-1.html"), true);
    assert.equal(isNonBuyerDiscoveryHost("https://www.olx.com.pk/item/villa"), true);
    assert.equal(isNonBuyerDiscoveryHost("https://facebook.com/groups/karachivillas"), true);
    assert.equal(isNonBuyerDiscoveryHost("https://www.youtube.com/watch?v=abc"), true);
    assert.equal(isNonBuyerDiscoveryHost("https://search.savills.com/in/en/list"), true);
    assert.equal(isNonBuyerDiscoveryHost("https://jaageer.com/listing"), true);
    assert.equal(isNonBuyerDiscoveryHost("https://cozycozy.com/pk/karachi"), true);
  });

  it("keeps real company and brokerage sites", () => {
    assert.equal(isNonBuyerDiscoveryHost("https://www.emaar.com"), false);
    assert.equal(isNonBuyerDiscoveryHost("https://www.savills.com/insight"), false);
    assert.equal(isNonBuyerDiscoveryHost("https://gulfstreamjets.example"), false);
  });
});

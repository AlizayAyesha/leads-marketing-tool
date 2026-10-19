import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchLayer1Actor, searchTermsFor } from "./catalog";
import { extractDecisionMakersFromText } from "./people";
import { scoreEliteProspect } from "./signals";

describe("elite catalog", () => {
  it("builds Dubai aviation + real estate + yacht searches", () => {
    const terms = searchTermsFor("Dubai", ["private_aviation", "luxury_real_estate", "superyacht"]);
    assert.ok(terms.some((term) => /Dubai private jet/i.test(term)));
    assert.ok(terms.some((term) => /Dubai luxury real estate/i.test(term)));
    assert.ok(terms.some((term) => /Dubai luxury villa developer/i.test(term)));
    assert.ok(!terms.some((term) => /\bvilla sales\b/i.test(term)));
    assert.ok(terms.some((term) => /Dubai yacht/i.test(term)));
  });

  it("matches Maps actors and skips LinkedIn scrapers", () => {
    assert.equal(
      matchLayer1Actor({ actorId: "compass/crawler-google-places", displayName: "Google Maps Business Lead + Website Scraper" }),
      "maps_website",
    );
    assert.equal(
      matchLayer1Actor({ actorId: "user/maps-email", displayName: "Google Maps Leads Scraper — Email/Phone/Audit" }),
      "maps_email_audit",
    );
    assert.equal(matchLayer1Actor({ actorId: "x/google-maps-scraper", displayName: "Google Maps Scraper" }), null);
    assert.equal(matchLayer1Actor({ actorId: "x/soon-open", displayName: "Soon-to-Open Businesses Leads Scraper (Google Maps)" }), null);
    assert.equal(matchLayer1Actor({ actorId: "x/linkedin-scraper", displayName: "LinkedIn people" }), null);
  });
});

describe("elite signals", () => {
  it("scores a private jet company as a high-value market, not a rich-person claim", () => {
    const scored = scoreEliteProspect({
      company: "Gulf Stream Jets",
      industry: "private jet charter",
      location: "Dubai",
      website: "https://gulfstreamjets.example",
      email: "ceo@gulfstreamjets.example",
      roleTitle: "CEO",
      notes: "Private jet charter. WhatsApp inquiries. No online booking. Fleet expansion.",
    });
    assert.equal(scored.signals.find((item) => item.id === "private_aviation")?.present, true);
    assert.match(scored.narrative, /high-value market/i);
    assert.match(scored.pitch, /Pitch /);
    assert.ok(["AUTOMATION", "WEB_SOFTWARE", "AI_ARCHITECTURE", "AI_VIDEO_ADS", "GRAPHICS"].includes(scored.offer.primary));
    assert.doesNotMatch(scored.narrative, /this person is rich/i);
    assert.ok(scored.total >= 40);
  });

  it("does not invent elite aviation on a generic bakery", () => {
    const scored = scoreEliteProspect({
      company: "Two-Person Bakery",
      industry: "bakery",
      location: "Helsinki",
      email: "hi@bakery.example",
      roleTitle: "Owner",
    });
    assert.equal(scored.signals.find((item) => item.id === "private_aviation")?.present, false);
    assert.match(scored.narrative, /Not enough evidence/);
  });
});

describe("decision maker extraction", () => {
  it("pulls CEO names from public about copy", () => {
    const people = extractDecisionMakersFromText("Meet Ahmed Khan, CEO of the charter desk in Dubai Marina.");
    assert.equal(people[0]?.role, "CEO");
    assert.equal(people[0]?.name, "Ahmed Khan");
  });
});

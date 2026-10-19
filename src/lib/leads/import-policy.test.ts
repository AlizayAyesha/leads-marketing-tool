import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { setActiveBusinessProfile } from "@/lib/business/profile";
import { decideImportLead } from "@/lib/leads/import-policy";
import { isGoogleMapsUrl } from "@/lib/scraping/maps-url";
import { listingExclusion } from "@/lib/outreach/buyer-icp";

afterEach(() => setActiveBusinessProfile(null));

const MAPS = "https://www.google.com/maps/place/Smile+Dental/@25.2,55.27,17z";

describe("Google Maps URLs", () => {
  it("recognises place links and leaves company sites alone", () => {
    assert.equal(isGoogleMapsUrl(MAPS), true);
    assert.equal(isGoogleMapsUrl("https://maps.google.com/?cid=123"), true);
    assert.equal(isGoogleMapsUrl("https://maps.app.goo.gl/abc"), true);
    assert.equal(isGoogleMapsUrl("https://smile.example"), false);
    assert.equal(isGoogleMapsUrl("https://www.google.com/search?q=dentist"), false);
  });
});

describe("import policy", () => {
  it("keeps a company listing that fits the profile and has a website, even when the source is Google Maps", () => {
    const decision = decideImportLead({
      company: "Smile Dental",
      industry: "Dentist",
      location: "Dubai",
      website: "https://smile.example",
      sourceUrl: MAPS,
    });
    assert.equal(decision.action, "store");
    assert.equal(decision.website, "https://smile.example");
    assert.equal(decision.profile?.status, "KEPT");
    assert.equal(decision.profile?.label, "Profile match");
    assert.ok((decision.profile?.score ?? 0) >= 50);
  });

  it("does not treat a Maps URL as the company website, and still matches when an email exists", () => {
    const decision = decideImportLead({
      company: "Smile Dental",
      industry: "Dental clinic",
      location: "Dubai",
      website: MAPS,
      email: "hello@smile.example",
      sourceUrl: MAPS,
    });
    assert.equal(decision.action, "store");
    assert.equal(decision.website, null);
    assert.equal(decision.profile?.status, "KEPT");
    assert.match(decision.profile?.reason ?? "", /email/i);
  });

  it("stores a Maps listing with no real contact, without calling it a profile match", () => {
    const decision = decideImportLead({
      company: "Smile Dental",
      industry: "Dentist",
      location: "Dubai",
      website: MAPS,
    });
    assert.equal(decision.action, "store");
    assert.equal(decision.website, null);
    assert.equal(decision.profile, null);
  });

  it("removes Google Maps agency categories that do not say agency", () => {
    for (const industry of [
      "Internet marketing service",
      "Marketing agency",
      "Advertising agency",
      "Website designer",
    ]) {
      const decision = decideImportLead({
        company: "Northstar",
        industry,
        location: "Dubai",
        website: "https://northstar.example",
      });
      assert.equal(decision.action, "skip-excluded", industry);
      assert.equal(listingExclusion(industry)?.code, "AGENCY_HOLDER", industry);
    }
  });

  it("keeps a real-estate developer and a property developer", () => {
    for (const industry of ["Real estate developer", "Property developer"]) {
      const decision = decideImportLead({
        company: "Palm Homes",
        industry,
        location: "Dubai",
        website: "https://palm.example",
      });
      assert.equal(decision.action, "store", industry);
      assert.equal(decision.profile?.status, "KEPT", industry);
      assert.equal(listingExclusion(industry), null, industry);
    }
  });

  it("still removes a software developer", () => {
    const decision = decideImportLead({
      company: "Acme",
      industry: "Software developer",
      website: "https://acme.example",
    });
    assert.equal(decision.action, "skip-excluded");
    assert.equal(listingExclusion("Developer at a software company")?.code, "PEER_BUILDER_OR_DESIGNER");
  });

  it("keeps a real-estate agency", () => {
    const decision = decideImportLead({
      company: "Palm Homes",
      industry: "Real estate agency",
      location: "Dubai",
      website: "https://palm.example",
    });
    assert.equal(decision.action, "store");
    assert.equal(listingExclusion("Real estate agency"), null);
  });

  it("removes a digital marketing agency from the category alone, with no job title", () => {
    const decision = decideImportLead({
      company: "Boost Media",
      industry: "Digital marketing agency",
      location: "Dubai",
      website: "https://boost.example",
      email: "hi@boost.example",
    });
    assert.equal(decision.action, "skip-excluded");
    assert.match(decision.exclusionReason ?? "", /agency/i);
    assert.equal(listingExclusion("Digital marketing agency")?.code, "AGENCY_HOLDER");
  });

  it("removes a software company that matches the tech-peer exclusion", () => {
    const decision = decideImportLead({
      company: "Acme Software House",
      industry: "Software company",
      website: "https://acme.example",
    });
    assert.equal(decision.action, "skip-excluded");
    assert.match(decision.exclusionReason ?? "", /software|tech|IT/i);
  });

  it("still drops listing portals", () => {
    const decision = decideImportLead({
      company: "Villa listing",
      website: "https://www.bayut.com/villa",
      sourceUrl: "https://www.bayut.com/villa",
    });
    assert.equal(decision.action, "skip-non-buyer");
  });

  it("drops a portal source when that is the only URL", () => {
    const decision = decideImportLead({
      company: "Villa listing",
      sourceUrl: "https://www.zameen.com/Homes/Karachi",
    });
    assert.equal(decision.action, "skip-non-buyer");
  });

  it("requires the profile location when one is set", () => {
    setActiveBusinessProfile({ targetLocations: ["Berlin"], targetIndustries: ["dentist"] });
    const kept = decideImportLead({
      company: "Berlin Dental",
      industry: "Dentist",
      location: "Berlin",
      website: "https://berlin-dental.example",
    });
    const missed = decideImportLead({
      company: "Dubai Dental",
      industry: "Dentist",
      location: "Dubai",
      website: "https://dubai-dental.example",
    });
    assert.equal(kept.profile?.status, "KEPT");
    assert.equal(missed.action, "store");
    assert.equal(missed.profile, null);
  });
});

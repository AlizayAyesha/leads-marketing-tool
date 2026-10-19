import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultCampaignBrief, matchesCampaignGeo } from "@/lib/campaigns/intent";
import { wantsOurServices } from "./wants-services";

describe("wantsOurServices", () => {
  it("blocks tech peers even with need language", () => {
    const r = wantsOurServices({
      roleTitle: "Software Engineer",
      company: "Acme AI Labs",
      originalPost: "looking for a website developer",
      linkedinUrl: "https://linkedin.com/in/eng",
      channel: "LINKEDIN",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TECH_PEER");
  });

  it("blocks founder with no demand signal", () => {
    const r = wantsOurServices({
      roleTitle: "Founder & CEO",
      company: "Helsinki Dental Clinic",
      industry: "clinic",
      linkedinUrl: "https://linkedin.com/in/founder",
      channel: "LINKEDIN",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "NO_DEMAND_SIGNAL");
  });

  it("pitches a sheet clinic owner as a new LinkedIn connection without hire language or a Decision Maker PASS", () => {
    const r = wantsOurServices({
      roleTitle: "Owner",
      company: "Karachi Dental Clinic",
      industry: "dental",
      linkedinUrl: "https://linkedin.com/in/owner",
      source: "google-sheets",
      nominatedConnection: true,
      channel: "LINKEDIN",
    });
    assert.equal(r.ok, true, r.reason);
  });

  it("does not invite a sheet tech peer as a LinkedIn connection", () => {
    const r = wantsOurServices({
      roleTitle: "Founder",
      company: "Acme AI Labs",
      linkedinUrl: "https://linkedin.com/in/founder",
      source: "google-sheets",
      nominatedConnection: true,
      channel: "LINKEDIN",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TECH_PEER");
  });

  it("pitches a sheet-nominated connected non-tech buyer without hire language", () => {
    const r = wantsOurServices({
      roleTitle: "Owner",
      company: "Karachi Dental Clinic",
      industry: "dental",
      linkedinUrl: "https://linkedin.com/in/owner",
      source: "google-sheets",
      connectedMessage: true,
      channel: "LINKEDIN",
    });
    assert.equal(r.ok, true);
    assert.equal(r.code, "WANTS_SERVICES");
  });

  it("still blocks a sheet agency holder even if connected", () => {
    const r = wantsOurServices({
      roleTitle: "Agency Owner",
      company: "Karachi Marketing Agency",
      linkedinUrl: "https://linkedin.com/in/agency",
      source: "google-sheets",
      connectedMessage: true,
      channel: "LINKEDIN",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "AGENCY_HOLDER");
  });

  it("pitches a sheet company with no person title when already connected", () => {
    const r = wantsOurServices({
      company: "Karachi Dental Clinic",
      linkedinUrl: "https://linkedin.com/in/someone",
      source: "csv",
      connectedMessage: true,
      channel: "LINKEDIN",
    });
    assert.equal(r.ok, true);
  });

  it("pitches an already-connected 1st-degree founder from the connections list", () => {
    const r = wantsOurServices({
      name: "Oksana Farenik • 1st Turning Reed into High-Value Sustainable Products | Co-founder",
      linkedinUrl: "https://linkedin.com/in/oksana",
      source: "linkedin_connections_message",
      connectedMessage: true,
      channel: "LINKEDIN",
    });
    assert.equal(r.ok, true, r.reason);
  });

  it("allows buyer + explicit hire language", () => {
    const r = wantsOurServices({
      roleTitle: "Owner",
      company: "Turku Restaurant Oy",
      originalPost: "looking for a website rebuild for our restaurant",
      linkedinUrl: "https://linkedin.com/in/owner",
      channel: "LINKEDIN",
    });
    assert.equal(r.ok, true);
    assert.equal(r.code, "WANTS_SERVICES");
  });

  it("allows buyer + Decision Maker serviceNeed PASS", () => {
    const r = wantsOurServices({
      roleTitle: "CEO",
      company: "Local Construction Ltd",
      serviceNeedStatus: "PASS",
      twitterUrl: "https://x.com/ceo",
      channel: "X_TWITTER",
    });
    assert.equal(r.ok, true);
  });

  it("allows PRIORITY opportunity selection", () => {
    const r = wantsOurServices({
      roleTitle: "Managing Director",
      company: "Boutique Hotel Group",
      opportunitySelection: "PRIORITY",
      email: "md@hotel.example",
      channel: "EMAIL",
    });
    assert.equal(r.ok, true);
  });

  it("allows Maps-style email lead: non-tech business + need notes", () => {
    const r = wantsOurServices({
      company: "Rosterturku",
      website: "https://rosterturku.com",
      industry: "restaurant",
      notes: "needs website redesign",
      email: "hello@rosterturku.com",
      channel: "EMAIL",
    });
    assert.equal(r.ok, true);
  });

  it("rejects opportunity REJECT", () => {
    const r = wantsOurServices({
      roleTitle: "Owner",
      company: "Clinic",
      opportunitySelection: "REJECT",
      serviceNeedStatus: "PASS",
      email: "o@clinic.example",
      channel: "EMAIL",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "REJECTED_OPPORTUNITY");
  });

  it("rejects email without contact", () => {
    const r = wantsOurServices({
      company: "Karachi Clinic",
      website: "https://clinic.pk",
      industry: "clinic",
      notes: "needs website redesign",
      location: "Karachi",
      channel: "EMAIL",
      campaignBrief: defaultCampaignBrief(),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "NOT_CONTACTABLE");
  });

  it("rejects wrong geo when brief cities are set", () => {
    const r = wantsOurServices({
      company: "Helsinki Cafe",
      website: "https://cafe.fi",
      industry: "cafe",
      notes: "looking for a website rebuild",
      email: "hi@cafe.fi",
      location: "Helsinki, Finland",
      channel: "EMAIL",
      campaignBrief: defaultCampaignBrief(),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "WRONG_GEO");
  });

  it("allows Karachi lead when brief includes Karachi", () => {
    const r = wantsOurServices({
      company: "Karachi Dental",
      website: "https://dental.pk",
      industry: "dental clinic",
      notes: "needs modern website and AI booking",
      email: "hello@dental.pk",
      location: "Karachi, Pakistan",
      channel: "EMAIL",
      campaignBrief: defaultCampaignBrief(),
    });
    assert.equal(r.ok, true);
    assert.equal(r.code, "WANTS_SERVICES");
  });

  it("allows Sao Paulo alias match", () => {
    const r = wantsOurServices({
      company: "SP Logistics",
      website: "https://sp-log.br",
      industry: "logistics",
      notes: "looking to hire a software developer",
      email: "ops@sp-log.br",
      location: "Sao Paulo, Brazil",
      channel: "EMAIL",
      campaignBrief: defaultCampaignBrief(),
    });
    assert.equal(r.ok, true);
  });

  it("empty brief skips geo gate (world OK)", () => {
    const r = wantsOurServices({
      company: "Tokyo Shop",
      website: "https://shop.jp",
      industry: "retail",
      notes: "needs website redesign",
      email: "a@shop.jp",
      location: "Tokyo",
      channel: "EMAIL",
      campaignBrief: {},
    });
    assert.equal(r.ok, true);
  });
});

describe("matchesCampaignGeo", () => {
  it("matches Goiânia with ascii goiania", () => {
    assert.equal(matchesCampaignGeo("Goiânia, Brasil", defaultCampaignBrief()), true);
    assert.equal(matchesCampaignGeo("goiania brazil", defaultCampaignBrief()), true);
  });

  it("rejects unrelated city", () => {
    assert.equal(matchesCampaignGeo("London, UK", { cities: ["Karachi"], regions: ["Pakistan"] }), false);
  });

  it("matches Ibiza, Mykonos, and Dubai on default brief", () => {
    const brief = defaultCampaignBrief();
    assert.equal(matchesCampaignGeo("Ibiza, Spain", brief), true);
    assert.equal(matchesCampaignGeo("Mykonos, Greece", brief), true);
    assert.equal(matchesCampaignGeo("Dubai Marina", brief), true);
  });
});

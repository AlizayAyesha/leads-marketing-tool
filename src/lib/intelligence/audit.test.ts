import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditLead, tightenVerdict } from "./audit";

describe("decision-maker audit", () => {
  it("passes an established professional with a matching company email", () => {
    const result = auditLead({
      name: "Ada Khan",
      company: "Khan Clinics",
      website: "https://khanclinics.com",
      websiteHost: "khanclinics.com",
      email: "ada@khanclinics.com",
      linkedinUrl: "https://www.linkedin.com/in/ada-khan",
      industry: "healthcare",
      rawPayload: {
        headline: "Founder & Clinic Director",
        experiences: [{ title: "Founder" }, { title: "Director" }, { title: "Associate" }],
        connections: 800,
      },
    });
    assert.equal(result.verdict, "PASS");
    assert.equal(result.professional, "PROFESSIONAL");
    assert.equal(result.email.status, "PASS");
    assert.equal(result.linkedin.seniority, "established");
    assert.ok(result.allowedChannels.includes("EMAIL"));
    assert.ok(result.allowedChannels.includes("LINKEDIN"));
  });

  it("rejects a disposable email with no other usable channel", () => {
    const result = auditLead({
      email: "asdf@mailinator.com",
      name: "Test",
    });
    assert.equal(result.email.status, "FAIL");
    assert.equal(result.verdict, "REJECT");
    assert.equal(result.allowedChannels.length, 0);
  });

  it("rejects a LinkedIn newbie who is not a business and has no service need", () => {
    const result = auditLead({
      name: "Sam",
      linkedinUrl: "https://linkedin.com/in/sam-intern",
      rawPayload: {
        headline: "Computer science student looking for internship",
        experiences: [],
      },
    });
    assert.equal(result.linkedin.seniority, "newbie");
    assert.equal(result.verdict, "REJECT");
    assert.ok(!result.allowedChannels.includes("LINKEDIN"));
  });

  it("holds when LinkedIn URL is real but seniority evidence is missing", () => {
    const result = auditLead({
      name: "Jordan Lee",
      company: "Lee Studio",
      website: "https://leestudio.co",
      email: "jordan@leestudio.co",
      linkedinUrl: "https://linkedin.com/in/jordanlee",
    });
    assert.equal(result.linkedin.status, "UNKNOWN");
    assert.equal(result.verdict, "HOLD");
    assert.ok(result.unknowns.some((item) => /seniority/i.test(item) || /unproven/i.test(item)));
  });

  it("treats personal Instagram as not professional unless they asked for a service", () => {
    const personal = auditLead({
      name: "Alex",
      instagramUrl: "https://instagram.com/alextravels",
      rawPayload: { biography: "love travel and coffee", isBusinessAccount: false },
    });
    assert.equal(personal.instagram.presence, "personal");
    assert.equal(personal.verdict, "REJECT");

    const needsHelp = auditLead({
      name: "Alex",
      email: "alex.bakery@gmail.com",
      company: "Alex Bakery",
      website: "https://alexbakery.example",
      instagramUrl: "https://instagram.com/alextravels",
      originalPost: "Need a website for my bakery",
      rawPayload: { biography: "love travel and coffee", isBusinessAccount: false },
    });
    assert.equal(needsHelp.serviceNeed.status, "PASS");
    assert.ok(needsHelp.verdict === "PASS" || needsHelp.verdict === "HOLD");
    assert.ok(needsHelp.allowedChannels.includes("EMAIL"));
  });

  it("accepts Instagram business flags as professional presence", () => {
    const result = auditLead({
      company: "North Studio",
      website: "https://northstudio.co",
      email: "hello@northstudio.co",
      instagramUrl: "https://instagram.com/northstudio",
      rawPayload: {
        biography: "Architecture studio in Karachi",
        isBusinessAccount: true,
        businessCategoryName: "Architect",
      },
    });
    assert.equal(result.instagram.presence, "professional");
    assert.ok(result.allowedChannels.includes("INSTAGRAM"));
  });

  it("does not treat a LinkedIn search URL as a profile", () => {
    const result = auditLead({
      company: "Acme",
      website: "https://acme.com",
      email: "ops@acme.com",
      linkedinUrl: "https://www.linkedin.com/search/results/people/?keywords=acme",
    });
    assert.equal(result.linkedin.status, "FAIL");
    assert.ok(!result.allowedChannels.includes("LINKEDIN"));
  });

  it("lets AI tighten a verdict but never loosen it", () => {
    assert.equal(tightenVerdict("PASS", "HOLD"), "HOLD");
    assert.equal(tightenVerdict("HOLD", "PASS"), "HOLD");
    assert.equal(tightenVerdict("REJECT", "PASS"), "REJECT");
  });

  it("passes an X buyer with stated Acme Studio service need", () => {
    const result = auditLead({
      name: "Ops Founder",
      twitterUrl: "https://x.com/ops_founder",
      source: "twitter_intent",
      originalPost: "I need a web developer to rebuild our company website ASAP",
      notes: "X intent discovery. Intent + service hints: website, developer",
    });
    assert.equal(result.serviceNeed.status, "PASS");
    assert.ok(result.allowedChannels.includes("X_TWITTER"));
    assert.equal(result.verdict, "PASS");
  });

  it("does not PASS an X profile with no buying intent", () => {
    const result = auditLead({
      name: "Random",
      twitterUrl: "https://x.com/random",
      originalPost: "Coffee is good today",
    });
    assert.ok(result.allowedChannels.includes("X_TWITTER"));
    assert.notEqual(result.verdict, "PASS");
  });
});

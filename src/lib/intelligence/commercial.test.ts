import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluatePriorityGate, qualifyCommercial } from "./commercial";
import { classifyObserved, sealAgainstLaundering } from "./evidence";
import { matchNamedIcp } from "./icps";
import { matchOfferMatrix } from "./offer-matrix";
import { opportunityStateFromLead } from "./opportunity-state";
import { summarizeLearning } from "./learning";
import { createCampaignExperiment, EXPERIMENT_SAMPLE } from "./experiment";
import { evaluateCanSend, PRODUCTION_SEND_EVIDENCE } from "./send-invariant";

function fact(claim: string, url: string, snippet: string) {
  return {
    claim,
    type: "FACT" as const,
    source: url,
    sourceUrl: url,
    snippet,
    timestamp: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    confidence: "high" as const,
  };
}

describe("named ICPs", () => {
  it("does not treat luxury itself as an ICP", () => {
    const miss = matchNamedIcp("Luxury company in Dubai");
    assert.equal(miss.confirmed, false);
    const hit = matchNamedIcp("Dubai private jet charter");
    assert.equal(hit.icp?.id, "private_aviation");
    assert.equal(hit.businessModel, "Jet Charter");
  });
});

describe("evidence classification", () => {
  it("refuses FACT without URL + snippet", () => {
    const guess = classifyObserved({ claim: "They're expanding", sourceUrl: null, snippet: "" });
    assert.equal(guess.type, "HYPOTHESIS");
    const real = classifyObserved({
      claim: "Opened a Riyadh base",
      sourceUrl: "https://news.example/expansion",
      snippet: "Gulf Stream Jets opens Riyadh operations",
    });
    assert.equal(real.type, "FACT");
  });
});

describe("commercial 100-point scorer (spec fixtures)", { concurrency: 1 }, () => {
  it("Riyadh luxury developer + Meta ads + launch → Video primary, nurture without FACT evidence", () => {
    const q = qualifyCommercial({
      company: "Najd Residences",
      industry: "luxury real estate developer",
      location: "Riyadh",
      email: "ceo@najd.example",
      linkedinUrl: "https://linkedin.com/in/najd-ceo",
      roleTitle: "CEO",
      highTicket: true,
      notes: "Running Meta ads with static creatives. New launch this quarter. Weak landing is a generic contact form.",
      signals: { metaAdsActive: true, poorCreative: true, newLaunch: true, weakLanding: true, luxuryVertical: true },
    });
    assert.equal(q.rejected, false);
    assert.equal(q.offer.primary, "AI_VIDEO_ADS");
    assert.ok(q.offer.scores.AI_VIDEO_ADS >= 80);
    assert.equal(q.priority, false);
    assert.equal(q.nurture, true);
    assert.notEqual(q.band, "APPROVE_QUEUE");
    assert.equal(q.brief.selection, "NURTURE");
    assert.ok(q.breakdown.abilityToPay >= 4);
    assert.equal(q.total, q.brief.buyNowScore);
    assert.ok(q.total === q.breakdown.icpFit + q.breakdown.buyingSignal + q.breakdown.painEvidence + q.breakdown.technologyGap + q.breakdown.decisionMaker + q.breakdown.dataQuality);
  });

  it("Muscat multi-property WhatsApp CS → Architecture + Automation high, Video not primary", () => {
    const q = qualifyCommercial({
      company: "Gulf Stay Hospitality",
      industry: "hotel resort",
      location: "Muscat",
      email: "ops@gulfstay.example",
      linkedinUrl: "https://linkedin.com/in/gulfstay-md",
      roleTitle: "Managing Director",
      highTicket: true,
      notes: "12 properties. WhatsApp customer-service operation. No online booking. Multiple systems. Manual follow-up.",
      signals: {
        multipleLocations: true,
        whatsappHeavy: true,
        noBooking: true,
        operationalComplexity: true,
        luxuryVertical: true,
      },
    });
    assert.equal(q.rejected, false);
    assert.ok(q.offer.scores.AI_ARCHITECTURE >= 70);
    assert.ok(q.offer.scores.AUTOMATION >= 70);
    assert.ok(q.offer.primary === "AI_ARCHITECTURE" || q.offer.primary === "AUTOMATION");
    assert.ok(q.offer.scores.AI_VIDEO_ADS < q.offer.scores.AI_ARCHITECTURE);
    assert.equal(q.brief.icp, "luxury_hospitality");
    assert.equal(q.priority, false);
  });

  it("London family office, no ads → Architecture high, Video low", () => {
    const q = qualifyCommercial({
      company: "Ashford Family Office",
      industry: "family office",
      location: "London",
      email: "principal@ashford.example",
      linkedinUrl: "https://linkedin.com/in/ashford-principal",
      roleTitle: "Principal",
      notes: "Multi-entity operations, document-heavy knowledge base, hiring operations. No Meta ads, no Instagram ads.",
      signals: { operationalComplexity: true, documentHeavy: true, hiringOps: true },
    });
    assert.equal(q.rejected, false);
    assert.equal(q.offer.primary, "AI_ARCHITECTURE");
    assert.ok(q.offer.scores.AI_ARCHITECTURE >= 65, `architecture=${q.offer.scores.AI_ARCHITECTURE}`);
    assert.ok(q.offer.scores.AI_VIDEO_ADS < 50, `video=${q.offer.scores.AI_VIDEO_ADS}`);
    assert.equal(q.brief.icp, "family_office_investment");
  });

  it("tiny shop with no signal → REJECT", () => {
    const q = qualifyCommercial({
      company: "Two-Person Bakery",
      industry: "bakery",
      location: "Helsinki",
      email: "hi@bakery.example",
      roleTitle: "Owner",
      estimatedEmployees: 2,
      notes: "Local bakery. No ads, no launch, no hiring.",
    });
    assert.equal(q.rejected, true);
    assert.equal(q.band, "REJECT");
    assert.equal(q.rejectReason, "LOW_TICKET_NO_SIGNAL");
    assert.equal(q.brief.selection, "REJECT");
  });

  it("Dubai yacht charter + IG/Meta → Video extremely high, still NURTURE without FACT Why Now", () => {
    const q = qualifyCommercial({
      company: "Pearl Yacht Charter",
      industry: "yacht charter",
      location: "Dubai",
      email: "owner@pearl.example",
      linkedinUrl: "https://linkedin.com/in/pearl-owner",
      instagramUrl: "https://instagram.com/pearlyacht",
      roleTitle: "Owner",
      highTicket: true,
      notes: "Superyacht charter. Active Meta ads and Instagram. High-ticket visual brand. New summer package launch.",
      signals: {
        metaAdsActive: true,
        instagramActive: true,
        highTicketVisual: true,
        luxuryVertical: true,
        newLaunch: true,
      },
    });
    assert.equal(q.rejected, false);
    assert.equal(q.offer.primary, "AI_VIDEO_ADS");
    assert.ok(q.offer.scores.AI_VIDEO_ADS >= 90, `video=${q.offer.scores.AI_VIDEO_ADS}`);
    assert.equal(q.priority, false);
    assert.notEqual(q.band, "APPROVE_QUEUE");
  });

  it("does not let graphics beat AI ads/UGC when Meta + launch + luxury are present", () => {
    const q = qualifyCommercial({
      company: "Najd Residences",
      industry: "luxury real estate developer",
      location: "Riyadh",
      email: "ceo@najd.example",
      linkedinUrl: "https://linkedin.com/in/najd-ceo",
      roleTitle: "CEO",
      highTicket: true,
      notes: "Running Meta ads with static creatives. New launch this quarter.",
      signals: { metaAdsActive: true, poorCreative: true, newLaunch: true, luxuryVertical: true, highTicketVisual: true },
    });
    assert.equal(q.offer.primary, "AI_VIDEO_ADS");
    assert.ok(q.offer.scores.AI_VIDEO_ADS > q.offer.scores.GRAPHICS);
  });

  it("AI software agency → REJECT prohibited industry", () => {
    const q = qualifyCommercial({
      company: "Nexus AI Software Agency",
      industry: "AI software agency",
      location: "Austin",
      email: "founder@nexus.example",
      linkedinUrl: "https://linkedin.com/in/nexus-founder",
      roleTitle: "Founder",
      softwareAgency: true,
      notes: "We build AI products for other startups.",
    });
    assert.equal(q.rejected, true);
    assert.equal(q.band, "REJECT");
    assert.equal(q.rejectReason, "PROHIBITED_INDUSTRY");
    assert.equal(q.total, 0);
  });

  it("evidence-backed aviation expansion becomes PRIORITY, not a wealth score", () => {
    const q = qualifyCommercial({
      company: "Gulf Stream Jets",
      industry: "private jet charter",
      location: "Dubai",
      website: "https://gulfstreamjets.example",
      email: "coo@gulfstreamjets.example",
      linkedinUrl: "https://linkedin.com/in/gulf-coo",
      roleTitle: "COO",
      notes: "Charter inquiries go through a generic contact form. No CRM.",
      signals: { newLocation: true, weakLanding: true, noBooking: true },
      evidence: [
        fact(
          "Company expanded charter operations into a new market.",
          "https://gulfstreamjets.example/news/riyadh",
          "Gulf Stream Jets opens Riyadh charter operations this quarter.",
        ),
        fact(
          "Charter inquiries currently appear to flow through a generic inquiry process.",
          "https://gulfstreamjets.example/contact",
          "Contact us — send a message and our team will get back to you.",
        ),
      ],
    });
    assert.equal(q.brief.icp, "private_aviation");
    assert.equal(q.priority, true);
    assert.equal(q.brief.selection, "PRIORITY");
    assert.equal(q.band, "APPROVE_QUEUE");
    assert.ok(q.brief.whyNow);
    assert.ok(q.brief.whyUs);
    assert.match(q.brief.recommendedCTA ?? "", /2-minute/i);
    assert.ok(q.brief.whyPrioritized);
    assert.equal(q.brief.layers.facts.length > 0, true);
    assert.equal(q.brief.triggerFreshness, "fresh");
  });

  it("score cannot create PRIORITY; stale FACT cannot; 72 with gate still PRIORITY", () => {
    const scored = qualifyCommercial({
      company: "Pearl Yacht Charter",
      industry: "yacht charter",
      location: "Dubai",
      email: "owner@pearl.example",
      linkedinUrl: "https://linkedin.com/in/pearl-owner",
      roleTitle: "Owner",
      highTicket: true,
      notes: "Superyacht charter. Active Meta ads. New summer package launch.",
      signals: { metaAdsActive: true, luxuryVertical: true, newLaunch: true, instagramActive: true, highTicketVisual: true },
    });
    assert.ok(scored.total >= 50 || scored.nurture);
    assert.equal(scored.priority, false);
    assert.equal(scored.brief.whyPrioritized, null);

    const gateOnly = evaluatePriorityGate({
      icpConfirmed: true,
      factWhyNow: true,
      factProblem: true,
      offer: true,
      dm: true,
      staleTrigger: false,
    });
    assert.equal(gateOnly.ok, true);
    assert.equal(
      evaluatePriorityGate({
        icpConfirmed: true,
        factWhyNow: true,
        factProblem: true,
        offer: true,
        dm: true,
        staleTrigger: true,
      }).ok,
      false,
    );
  });

  it("two-year-old expansion is stale and cannot prioritize", () => {
    const old = new Date();
    old.setFullYear(old.getFullYear() - 2);
    const q = qualifyCommercial({
      company: "Gulf Stream Jets",
      industry: "private jet charter",
      location: "Dubai",
      website: "https://gulfstreamjets.example",
      email: "coo@gulfstreamjets.example",
      linkedinUrl: "https://linkedin.com/in/gulf-coo",
      roleTitle: "COO",
      notes: "Charter inquiries go through a generic contact form.",
      signals: { newLocation: true, weakLanding: true, noBooking: true },
      evidence: [
        {
          claim: "Company expanded charter operations into a new market.",
          type: "FACT",
          source: "https://gulfstreamjets.example/news/old",
          sourceUrl: "https://gulfstreamjets.example/news/old",
          snippet: "Gulf Stream Jets opened Riyadh charter operations.",
          timestamp: old.toISOString(),
          observedAt: old.toISOString(),
          confidence: "high",
        },
        fact(
          "Charter inquiries currently appear to flow through a generic inquiry process.",
          "https://gulfstreamjets.example/contact",
          "Contact us — send a message and our team will get back to you.",
        ),
      ],
    });
    assert.equal(q.brief.triggerFreshness, "stale");
    assert.equal(q.priority, false);
  });

  it("never launders an inference into a FACT on a later pass", () => {
    const prior = [
      {
        claim: "Company manually handles leads.",
        type: "INFERENCE" as const,
        source: "https://gulfstreamjets.example/contact",
        sourceUrl: "https://gulfstreamjets.example/contact",
        snippet: "Contact us",
        timestamp: new Date().toISOString(),
        confidence: "medium" as const,
      },
    ];
    const later = sealAgainstLaundering(
      {
        claim: "Company manually handles leads.",
        type: "FACT",
        source: "https://gulfstreamjets.example/contact",
        sourceUrl: "https://gulfstreamjets.example/contact",
        snippet: "Contact us",
        timestamp: new Date().toISOString(),
        confidence: "high",
      },
      prior,
    );
    assert.equal(later.type, "INFERENCE");
  });

  it("wealth cannot compensate for zero buying intent", () => {
    const q = qualifyCommercial({
      company: "Quiet Palace Hotels",
      industry: "luxury hotel",
      location: "Dubai",
      email: "ceo@palace.example",
      linkedinUrl: "https://linkedin.com/in/palace-ceo",
      roleTitle: "CEO",
      highTicket: true,
      notes: "Five-star hotel. No ads, no launch, no hiring, no expansion.",
      signals: { luxuryVertical: true },
    });
    assert.equal(q.priority, false);
    assert.notEqual(q.band, "APPROVE_QUEUE");
    assert.ok(q.breakdown.abilityToPay > 0);
    assert.ok(q.total < q.breakdown.abilityToPay + 80);
  });
});

describe("offer matrix and experiment learning", () => {
  it("maps ads + weak landing to conversion leakage, not a random service family", () => {
    const row = matchOfferMatrix({ ads: true, weakLanding: true });
    assert.equal(row?.specificOffer, "AI landing + CRO");
  });

  it("locks experiment sample at 50", () => {
    const exp = createCampaignExperiment({ icp: "luxury_real_estate", sample: 500 });
    assert.equal(exp.sample, EXPERIMENT_SAMPLE);
  });

  it("ranks learning by qualified positive conversations, not raw replies", () => {
    const summary = summarizeLearning([
      {
        icp: "private_aviation",
        offer: "AI qualification",
        trigger: "expansion",
        angle: "LEAD_FOLLOWUP",
        decisionMakerRole: "COO",
        sent: true,
        replied: true,
        qualifiedPositive: true,
        meeting: true,
        lostReason: null,
      },
      {
        icp: "luxury_real_estate",
        offer: "generic website",
        trigger: "none",
        angle: "DIGITAL_CONVERSION",
        decisionMakerRole: "CEO",
        sent: true,
        replied: true,
        qualifiedPositive: false,
        meeting: false,
        lostReason: "poor_personalization",
      },
    ]);
    assert.match(summary[0]?.key ?? "", /private_aviation/);
    assert.equal(summary[0]?.qualifiedPositive, 1);
  });

  it("maps lead file states onto the opportunity OS", () => {
    assert.equal(opportunityStateFromLead({ status: "NEW" }), "DISCOVERED");
    assert.equal(opportunityStateFromLead({ status: "QUALIFIED", priority: true }), "OPPORTUNITY");
    assert.equal(opportunityStateFromLead({ status: "QUALIFIED", nurture: true, priority: false }), "NURTURE");
    assert.equal(opportunityStateFromLead({ status: "INTERESTED" }), "POSITIVE");
  });

  it("makes send impossible unless every invariant is true", () => {
    assert.equal(
      evaluateCanSend({
        killSwitch: false,
        draftOnly: false,
        humanApproval: true,
        ...PRODUCTION_SEND_EVIDENCE,
      }).ok,
      true,
    );
    assert.equal(
      evaluateCanSend({
        killSwitch: false,
        draftOnly: false,
        humanApproval: true,
        ...PRODUCTION_SEND_EVIDENCE,
        commercialScore: 99,
        commercialPriority: false,
      }).code,
      "PRIORITY_GATE",
    );
    assert.equal(
      evaluateCanSend({
        killSwitch: false,
        draftOnly: false,
        humanApproval: true,
        ...PRODUCTION_SEND_EVIDENCE,
        whyNowSnippet: "",
      }).code,
      "WHY_NOW_NO_SNIPPET",
    );
  });
});

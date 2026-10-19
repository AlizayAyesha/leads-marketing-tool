import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeConversationReply, isAskingForDeliverable, shouldStopLinkedInOnReply } from "@/lib/conversation/analyze";
import { LINKEDIN_MEETING_HOST, LINKEDIN_MEETING_URL } from "@/lib/conversation/booking";
import { assertNoBrochure, assertNoConsulting, assertNoPrematureBookingLink, assertNoPrematurePitch, draftConversationMessage } from "@/lib/conversation/draft";
import { reviewCommercialDraft } from "@/lib/conversation/qa";
import { matchConversationPain } from "@/lib/conversation/match";
import { decideConversationTransition, openingConversationStage } from "@/lib/conversation/machine";
import { canSendMessage } from "@/lib/outreach/gate";
import { DEFAULT_OUTREACH_ENGINE } from "@/lib/outreach/policy";

const ctx = {
  firstName: "Sarah",
  company: "Northwind Ops",
  headline: "CEO",
  about: null,
  roleTitle: "CEO",
  websiteTitle: null,
  observation: null,
  channel: "LINKEDIN" as const,
};

describe("conversation relationship state", () => {
  it("opens rapport after CONNECTED without pitching", () => {
    const opening = openingConversationStage();
    assert.equal(opening.to, "GETTING_TO_KNOW");
    assert.equal(opening.pitchAllowed, false);
    const drafted = draftConversationMessage({ stage: "GETTING_TO_KNOW", ctx });
    assert.match(drafted.message, /great to connect/i);
    assert.match(drafted.message, /good week/i);
    assert.doesNotMatch(drafted.message, /how's everything going/i);
    assert.doesNotMatch(drafted.message, /your business/i);
    assert.doesNotMatch(drafted.message, /quick call/i);
    assertNoPrematurePitch("GETTING_TO_KNOW", drafted.message);
    assertNoPrematureBookingLink("GETTING_TO_KNOW", drafted.message);
    assertNoConsulting(drafted.message);
  });

  it("waits when they accept but do not reply", () => {
    const analysis = analyzeConversationReply("");
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.wait, true);
    assert.equal(decision.to, "GETTING_TO_KNOW");
    assert.equal(decision.pitchAllowed, false);
  });

  it("keeps a casual reply warm and does not stop LinkedIn", () => {
    const analysis = analyzeConversationReply("Thanks for connecting! Busy week over here.");
    assert.equal(analysis.cue, "casual");
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "GETTING_TO_KNOW");
    assert.equal(decision.pitchAllowed, false);
    assert.equal(shouldStopLinkedInOnReply(analysis.cue), false);
    const drafted = draftConversationMessage({
      stage: "GETTING_TO_KNOW",
      ctx,
      cue: analysis.cue,
      replyExcerpt: "Thanks for connecting! Busy week over here.",
    });
    assert.match(drafted.message, /hope you're having a good week/i);
    assert.doesNotMatch(drafted.message, /your business/i);
    assertNoPrematurePitch("GETTING_TO_KNOW", drafted.message);
  });

  it("asks a discovery question on vague ops strain instead of pitching", () => {
    const analysis = analyzeConversationReply(
      "We're actually growing pretty quickly but operations are becoming difficult.",
    );
    assert.equal(analysis.cue, "problem");
    assert.equal(analysis.match.matched, false);
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "DISCOVERY");
    assert.equal(decision.pitchAllowed, false);
    const drafted = draftConversationMessage({
      stage: "DISCOVERY",
      ctx,
      replyExcerpt: "We're actually growing pretty quickly but operations are becoming difficult.",
    });
    assert.match(drafted.message, /getting in the way/i);
    assert.doesNotMatch(drafted.message, /your business/i);
    assert.doesNotMatch(drafted.message, /webhook/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assertNoPrematurePitch("DISCOVERY", drafted.message);
    assertNoPrematureBookingLink("DISCOVERY", drafted.message);
    assertNoConsulting(drafted.message);
  });

  it("positions a website-performance problem instead of giving technical advice", () => {
    const analysis = analyzeConversationReply("Our website is slow.");
    assert.equal(analysis.match.matched, true);
    assert.equal(analysis.match.service, "WEBSITE_DEVELOPMENT");
    assert.equal(analysis.intentScore, 3);
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "PITCH");
    assert.equal(decision.pitchAllowed, true);
    const drafted = draftConversationMessage({
      stage: "PITCH",
      ctx,
      match: analysis.match,
      cue: analysis.cue,
      replyExcerpt: "Our website is slow.",
    });
    assert.match(drafted.message, /your business/i);
    assert.match(drafted.message, /website/i);
    assert.doesNotMatch(drafted.message, /core web vitals/i);
    assert.doesNotMatch(drafted.message, /hosted/i);
    assert.doesNotMatch(drafted.message, /what technologies/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assertNoPrematureBookingLink("PITCH", drafted.message);
    assertNoConsulting(drafted.message);
  });

  it("pitches when they are looking for someone to rebuild the site", () => {
    const analysis = analyzeConversationReply("We're actually looking for someone to rebuild it.");
    assert.equal(analysis.cue, "asked_for_help");
    assert.equal(analysis.match.service, "WEBSITE_DEVELOPMENT");
    assert.equal(analysis.intentScore, 5);
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "LINK_SENT");
    assert.equal(decision.heat, "MEETING");
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      ctx,
      match: analysis.match,
      cue: analysis.cue,
    });
    assert.match(drafted.message, /\/go\/linkedin/i);
    assert.doesNotMatch(drafted.message, /cal\.example/i);
    assert.doesNotMatch(drafted.message, /webhook/i);
    assertNoConsulting(drafted.message);
  });

  it("pitches lost-lead follow-up as a buying signal, not a consulting plan", () => {
    const analysis = analyzeConversationReply(
      "Honestly, we're losing a lot of leads because nobody follows up quickly.",
    );
    assert.equal(analysis.match.matched, true);
    assert.equal(analysis.match.buyingSignal, true);
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "PITCH");
    const drafted = draftConversationMessage({ stage: "PITCH", ctx, match: analysis.match });
    assert.match(drafted.message, /your business/i);
    assert.match(drafted.message, /lead-handling|lead handling/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assert.doesNotMatch(drafted.message, /how many leads/i);
    assert.doesNotMatch(drafted.message, /what'?s your (current )?crm/i);
    assert.doesNotMatch(drafted.message, /ai, web development, automation and seo/i);
    assert.doesNotMatch(drafted.message, /lead scoring/i);
    assert.doesNotMatch(drafted.message, /webhook/i);
    assertNoPrematureBookingLink("PITCH", drafted.message);
    assertNoConsulting(drafted.message);
  });

  it("treats struggling-to-automate lead handling as a buying signal", () => {
    const analysis = analyzeConversationReply("We're struggling to automate our lead handling.");
    assert.equal(analysis.cue, "problem");
    assert.equal(analysis.match.matched, true);
    assert.equal(analysis.match.buyingSignal, true);
    assert.equal(analysis.match.service, "AI_AUTOMATION");
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "PITCH");
    assert.equal(decision.pitchAllowed, true);
    const drafted = draftConversationMessage({ stage: "PITCH", ctx, match: analysis.match });
    assert.match(drafted.message, /your business/i);
    assert.match(drafted.message, /lead-handling|lead handling/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assert.doesNotMatch(drafted.message, /webhook/i);
    assert.doesNotMatch(drafted.message, /lead scoring/i);
    assertNoPrematureBookingLink("PITCH", drafted.message);
    assertNoConsulting(drafted.message);
  });

  it("pitches after they explain the pain in discovery", () => {
    const analysis = analyzeConversationReply("We're struggling to manage all our incoming leads.");
    const decision = decideConversationTransition({
      from: "DISCOVERY",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "PITCH");
    assert.equal(decision.pitchAllowed, true);
  });

  it("positions a specific manual-work problem instead of interviewing", () => {
    const analysis = analyzeConversationReply("We're doing everything manually.");
    assert.equal(analysis.match.matched, true);
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "PITCH");
    assert.equal(decision.pitchAllowed, true);
    const drafted = draftConversationMessage({ stage: "PITCH", ctx, match: analysis.match });
    assert.match(drafted.message, /your business/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assert.doesNotMatch(drafted.message, /how many/i);
    assertNoConsulting(drafted.message);
  });

  it("pitches immediately when they ask what you do", () => {
    const analysis = analyzeConversationReply("What do you guys do?");
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "PITCH");
    assert.equal(decision.pitchAllowed, true);
    const drafted = draftConversationMessage({
      stage: "PITCH",
      ctx,
      cue: analysis.cue,
      match: analysis.match,
    });
    assert.match(drafted.message, /custom software/i);
    assert.match(drafted.message, /your business|we build/i);
    assert.doesNotMatch(drafted.message, /on your mind/i);
    assert.doesNotMatch(drafted.message, /you mentioned that bottleneck/i);
    assert.doesNotMatch(drafted.message, /struggling with/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assertNoPrematureBookingLink("PITCH", drafted.message);
  });

  it("offers booking immediately when they ask for help", () => {
    const analysis = analyzeConversationReply("Can you help us build this?");
    assert.equal(analysis.intentScore, 5);
    const decision = decideConversationTransition({
      from: "DISCOVERY",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "LINK_SENT");
    assert.equal(decision.pitchAllowed, true);
  });

  it("stops chatting and books when they say let's talk", () => {
    const analysis = analyzeConversationReply("Sure, let's talk.");
    assert.equal(analysis.intentScore, 5);
    const decision = decideConversationTransition({
      from: "PITCH",
      analysis,
      connected: true,
      hasBookingUrl: true,
    });
    assert.equal(decision.to, "LINK_SENT");
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      ctx: { ...ctx, publicLeadId: "ZJ-SARAH", conversationId: "conv-sarah" },
      cue: analysis.cue,
    });
    assert.match(drafted.message, /grab a time here/i);
    assert.match(drafted.message, /source=linkedin/);
    assert.match(drafted.message, /lead=ZJ-SARAH/);
    assert.match(drafted.message, /cid=conv-sarah/);
    assert.match(drafted.message, new RegExp(LINKEDIN_MEETING_HOST.replaceAll(".", "\\.")));
    assert.equal(drafted.message.includes(LINKEDIN_MEETING_URL), true);
    assert.doesNotMatch(drafted.message, /webhook/i);
  });

  it("stops extra discovery on pricing after a pitch", () => {
    const analysis = analyzeConversationReply("How much would something like that cost?");
    assert.equal(analysis.intentScore, 4);
    const decision = decideConversationTransition({
      from: "PITCH",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "LINK_SENT");
  });

  it("pushes a confirmed interest toward a meeting instead of more chat", () => {
    const analysis = analyzeConversationReply("Sounds good, that's exactly what we need.");
    assert.equal(analysis.intentScore, 4);
    const decision = decideConversationTransition({
      from: "PITCH",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "LINK_SENT");
    assert.equal(decision.heat, "HOT");
  });

  it("explains Acme Studio when they say interesting / tell me more, without manufacturing pain", () => {
    const analysis = analyzeConversationReply("Interesting, tell me more.");
    assert.equal(analysis.intentScore, 4);
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "INTEREST");
    assert.equal(decision.pitchAllowed, true);
    const drafted = draftConversationMessage({
      stage: "INTEREST",
      ctx,
      replyExcerpt: "Interesting, tell me more.",
      cue: analysis.cue,
    });
    assert.match(drafted.message, /we build/i);
    assert.doesNotMatch(drafted.message, /operations is becoming the biggest headache/i);
    assert.doesNotMatch(drafted.message, /struggling with/i);
    assert.doesNotMatch(drafted.message, /taking most of your time/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assertNoPrematureBookingLink("INTEREST", drafted.message);
  });

  it("soft-converts send-me-something instead of forcing another discovery question", () => {
    const analysis = analyzeConversationReply("Interesting. Send me something.");
    assert.equal(analysis.cue, "interested");
    assert.equal(analysis.intentScore, 4);
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "INTEREST");
    const drafted = draftConversationMessage({
      stage: "INTEREST",
      ctx,
      replyExcerpt: "Interesting. Send me something.",
      cue: analysis.cue,
      match: analysis.match,
    });
    assert.match(drafted.message, /short call/i);
    assert.match(drafted.message, /don'?t send generic decks/i);
    assert.doesNotMatch(drafted.message, /taking most of your time/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assertNoPrematureBookingLink("INTEREST", drafted.message);
    assertNoBrochure(drafted.message);
  });

  it("does not walk backward when they name real pain after asking what you do", () => {
    const analysis = analyzeConversationReply("Actually, we're struggling with our lead management.");
    assert.equal(analysis.match.service, "AI_AUTOMATION");
    assert.equal(analysis.match.buyingSignal, true);
    const decision = decideConversationTransition({
      from: "PITCH",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "INTEREST");
    const drafted = draftConversationMessage({
      stage: "INTEREST",
      ctx,
      replyExcerpt: "Actually, we're struggling with our lead management.",
      problem: analysis.problem,
      match: analysis.match,
      cue: analysis.cue,
    });
    assert.match(drafted.message, /lead handling|lead management/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assert.doesNotMatch(drafted.message, /taking most of your time/i);
    assertNoPrematureBookingLink("INTEREST", drafted.message);
    assertNoConsulting(drafted.message);
  });

  it("sends the LinkedIn CTA after tell me more once a problem has been positioned", () => {
    const analysis = analyzeConversationReply("Tell me more.");
    const decision = decideConversationTransition({
      from: "PITCH",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "LINK_SENT");
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      ctx,
      cue: analysis.cue,
      match: analysis.match,
    });
    assert.match(drafted.message, /grab a time here/i);
    assert.match(drafted.message, /\/go\/linkedin/i);
  });

  it("sends the LinkedIn CTA when they say they'd be interested", () => {
    const analysis = analyzeConversationReply("Yeah, I'd be interested.");
    assert.equal(analysis.cue, "meeting");
    const decision = decideConversationTransition({
      from: "PROBLEM_IDENTIFIED",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "LINK_SENT");
  });

  it("sends the LinkedIn CTA when they want to work together", () => {
    const analysis = analyzeConversationReply("How can we work together?");
    const decision = decideConversationTransition({
      from: "PITCH",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "LINK_SENT");
  });

  it("treats let us talk as meeting intent", () => {
    const analysis = analyzeConversationReply("Sure, let us talk.");
    assert.equal(analysis.cue, "meeting");
    const decision = decideConversationTransition({
      from: "PITCH",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "LINK_SENT");
  });

  it("marks a confirmed booking as MEETING_BOOKED", () => {
    const analysis = analyzeConversationReply("Booked — see you Thursday.");
    const decision = decideConversationTransition({
      from: "LINK_SENT",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "MEETING_BOOKED");
  });

  it("treats a launch deadline as why-now and positions Acme Studio", () => {
    const analysis = analyzeConversationReply(
      "We're launching our new service next month and the website isn't ready.",
    );
    assert.equal(analysis.whyNow.launch, true);
    assert.ok(analysis.whyNow.timeline);
    assert.equal(analysis.intentScore, 3);
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "PITCH");
    const drafted = draftConversationMessage({ stage: "PITCH", ctx, match: analysis.match });
    assertNoPrematureBookingLink("PITCH", drafted.message);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
  });

  it("treats REQUESTED as not connected", () => {
    const analysis = analyzeConversationReply("Hey!");
    const decision = decideConversationTransition({
      from: "NONE",
      analysis,
      connected: false,
    });
    assert.equal(decision.to, "NONE");
    assert.equal(decision.code, "NOT_CONNECTED");
  });

  it("stops immediately on no / do-not-contact", () => {
    const no = analyzeConversationReply("Not interested, thanks");
    assert.equal(shouldStopLinkedInOnReply(no.cue), true);
    assert.equal(
      decideConversationTransition({ from: "DISCOVERY", analysis: no, connected: true }).to,
      "STOPPED",
    );
    const dnc = analyzeConversationReply("Please do not contact me again");
    assert.equal(dnc.cue, "dnc");
    assert.equal(shouldStopLinkedInOnReply(dnc.cue), true);
  });
});

describe("LinkedIn salesperson behavior", () => {
  it("1. thanks for connecting stays rapport, with no pitch", () => {
    const analysis = analyzeConversationReply("Thanks for connecting.");
    assert.equal(analysis.cue, "casual");
    const decision = decideConversationTransition({
      from: "GETTING_TO_KNOW",
      analysis,
      connected: true,
    });
    assert.equal(decision.to, "GETTING_TO_KNOW");
    const drafted = draftConversationMessage({
      stage: "GETTING_TO_KNOW",
      ctx,
      cue: analysis.cue,
      replyExcerpt: "Thanks for connecting.",
    });
    assert.match(drafted.message, /hope you're having a good week/i);
    assert.doesNotMatch(drafted.message, /your business/i);
    assert.doesNotMatch(drafted.message, /quick call/i);
    assertNoPrematurePitch("GETTING_TO_KNOW", drafted.message);
  });

  it("2. a slow website is a web opportunity, not technical advice", () => {
    const analysis = analyzeConversationReply("Our website is really slow.");
    assert.equal(analysis.match.service, "WEBSITE_DEVELOPMENT");
    assert.equal(decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true }).to, "PITCH");
    const drafted = draftConversationMessage({
      stage: "PITCH",
      ctx,
      match: analysis.match,
      replyExcerpt: "Our website is really slow.",
    });
    assert.match(drafted.message, /your business/i);
    assert.doesNotMatch(drafted.message, /core web vitals|hosted|what technologies/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assertNoConsulting(drafted.message);
  });

  it("3. lost-lead follow-up is lead automation, not a discovery interview", () => {
    const analysis = analyzeConversationReply("We're losing leads because nobody follows up.");
    assert.equal(analysis.match.service, "AI_AUTOMATION");
    assert.equal(decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true }).to, "PITCH");
    const drafted = draftConversationMessage({ stage: "PITCH", ctx, match: analysis.match });
    assert.match(drafted.message, /your business/i);
    assert.match(drafted.message, /lead-handling|lead handling|follow-up/i);
    assert.doesNotMatch(drafted.message, /how many leads|what'?s your (current )?crm|where does the process break/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assertNoConsulting(drafted.message);
  });

  it("4. what does Acme Studio do gets commercial positioning, not discovery", () => {
    const analysis = analyzeConversationReply("What does Acme Studio do?");
    assert.equal(analysis.cue, "asked_what_you_do");
    assert.equal(decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true }).to, "PITCH");
    const drafted = draftConversationMessage({
      stage: "PITCH",
      ctx,
      cue: analysis.cue,
      match: analysis.match,
    });
    assert.match(drafted.message, /custom software/i);
    assert.doesNotMatch(drafted.message, /struggling with|on your mind|taking most of your time/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
  });

  it("5. can you help rebuild our website positions Acme Studio and sends the CTA", () => {
    const analysis = analyzeConversationReply("Can you help us rebuild our website?");
    const decision = decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true });
    assert.equal(decision.to, "LINK_SENT");
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      ctx,
      cue: analysis.cue,
      match: analysis.match,
      replyExcerpt: "Can you help us rebuild our website?",
    });
    assert.match(drafted.message, /your business/i);
    assert.match(drafted.message, /\/go\/linkedin/i);
  });

  it("6. interesting, tell me more explains Acme Studio and does not manufacture pain", () => {
    const analysis = analyzeConversationReply("Interesting, tell me more.");
    assert.equal(decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true }).to, "INTEREST");
    const drafted = draftConversationMessage({
      stage: "INTEREST",
      ctx,
      cue: analysis.cue,
      replyExcerpt: "Interesting, tell me more.",
    });
    assert.match(drafted.message, /we build/i);
    assert.doesNotMatch(drafted.message, /i noticed you're struggling|taking most of your time/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
  });

  it("7. send me something is a commercial next step, not a consulting dump", () => {
    const analysis = analyzeConversationReply("Send me something.");
    assert.equal(decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true }).to, "INTEREST");
    const drafted = draftConversationMessage({
      stage: "INTEREST",
      ctx,
      cue: analysis.cue,
      replyExcerpt: "Send me something.",
    });
    assert.match(drafted.message, /short call/i);
    assert.doesNotMatch(drafted.message, /step 1|here are \d|webhook/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assertNoBrochure(drafted.message);
  });

  it("8. sure, let's talk sends acme.example/go/linkedin", () => {
    const analysis = analyzeConversationReply("Sure, let's talk.");
    assert.equal(decideConversationTransition({ from: "PITCH", analysis, connected: true }).to, "LINK_SENT");
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      ctx,
      cue: analysis.cue,
    });
    assert.match(drafted.message, /\/go\/linkedin/i);
  });

  it("9. booked a time becomes MEETING_BOOKED and stops selling", () => {
    const analysis = analyzeConversationReply("Booked a time.");
    assert.equal(analysis.cue, "booked");
    const decision = decideConversationTransition({ from: "LINK_SENT", analysis, connected: true });
    assert.equal(decision.to, "MEETING_BOOKED");
    const drafted = draftConversationMessage({ stage: "MEETING_BOOKED", ctx, cue: analysis.cue });
    assert.match(drafted.message, /locked in|see you then/i);
    assert.doesNotMatch(drafted.message, /want to have a quick call/i);
  });

  it("10. not interested stops immediately", () => {
    const analysis = analyzeConversationReply("Not interested.");
    assert.equal(analysis.cue, "decline");
    assert.equal(decideConversationTransition({ from: "PITCH", analysis, connected: true }).to, "STOPPED");
    assert.equal(shouldStopLinkedInOnReply(analysis.cue), true);
  });

  it("11. an unrelated problem does not force a Acme Studio pitch", () => {
    const analysis = analyzeConversationReply("Our office landlord is being difficult.");
    assert.equal(analysis.match.matched, false);
    const decision = decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true });
    assert.equal(decision.to, "GETTING_TO_KNOW");
    assert.equal(decision.pitchAllowed, false);
    const drafted = draftConversationMessage({
      stage: "GETTING_TO_KNOW",
      ctx,
      cue: analysis.cue,
      replyExcerpt: "Our office landlord is being difficult.",
    });
    assert.doesNotMatch(drafted.message, /your business/i);
    assert.doesNotMatch(drafted.message, /quick call/i);
    assertNoPrematurePitch("GETTING_TO_KNOW", drafted.message);
  });

  it("12. no problem and no buying signal does not invent an opportunity", () => {
    const analysis = analyzeConversationReply("Hope you're well.");
    assert.equal(analysis.cue, "casual");
    assert.equal(analysis.match.matched, false);
    const decision = decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true });
    assert.equal(decision.to, "GETTING_TO_KNOW");
    const drafted = draftConversationMessage({
      stage: "GETTING_TO_KNOW",
      ctx,
      cue: analysis.cue,
      replyExcerpt: "Hope you're well.",
    });
    assert.doesNotMatch(drafted.message, /your business|automation|seo|website/i);
    assertNoPrematurePitch("GETTING_TO_KNOW", drafted.message);
  });

  it("13. how would you build this stays high-level and sends the meeting CTA", () => {
    const analysis = analyzeConversationReply("How would you build this?");
    assert.equal(analysis.cue, "asked_for_help");
    assert.equal(decideConversationTransition({ from: "PITCH", analysis, connected: true }).to, "LINK_SENT");
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      ctx,
      cue: analysis.cue,
      replyExcerpt: "How would you build this?",
    });
    assert.match(drafted.message, /your business/i);
    assert.match(drafted.message, /\/go\/linkedin/i);
    assert.doesNotMatch(drafted.message, /step 1|implementation plan|architecture|webhook/i);
    assertNoConsulting(drafted.message);
  });

  it("14. relevant pain after a pitch moves commercially instead of restarting discovery", () => {
    const analysis = analyzeConversationReply("Our website is really slow.");
    const decision = decideConversationTransition({ from: "PITCH", analysis, connected: true });
    assert.equal(decision.to, "INTEREST");
    const drafted = draftConversationMessage({
      stage: "INTEREST",
      ctx,
      cue: analysis.cue,
      match: analysis.match,
      replyExcerpt: "Our website is really slow.",
    });
    assert.match(drafted.message, /your business/i);
    assert.doesNotMatch(drafted.message, /getting in the way|taking most of your time/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
  });

  it("15. pricing moves toward a meeting instead of restarting discovery", () => {
    const analysis = analyzeConversationReply("How much does it cost?");
    assert.equal(analysis.cue, "buying_intent");
    assert.equal(decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true }).to, "LINK_SENT");
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      ctx,
      cue: analysis.cue,
      replyExcerpt: "How much does it cost?",
    });
    assert.match(drafted.message, /scope|pricing/i);
    assert.match(drafted.message, /\/go\/linkedin/i);
    assert.doesNotMatch(drafted.message, /taking most of your time|getting in the way/i);
  });

  it("does not keep pushing the booking link after LINK_SENT", () => {
    const analysis = analyzeConversationReply("Thanks, I'll take a look.");
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      fromStage: "LINK_SENT",
      ctx,
      cue: analysis.cue,
      replyExcerpt: "Thanks, I'll take a look.",
    });
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assert.doesNotMatch(drafted.message, /grab a time here/i);
  });
});

describe("commercial non-consulting guardrail", () => {
  function assertSellNotSolve(text: string) {
    const analysis = analyzeConversationReply(text);
    assert.equal(analysis.cue, "asked_for_help");
    assert.equal(isAskingForDeliverable(text), true);
    const decision = decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true });
    assert.equal(decision.to, "LINK_SENT");
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      ctx,
      cue: analysis.cue,
      match: analysis.match,
      replyExcerpt: text,
    });
    assert.match(drafted.message, /your business/i);
    assert.match(drafted.message, /\/go\/linkedin/i);
    assert.doesNotMatch(drafted.message, /n8n|zapier|hubspot|core web vitals|step 1|```|function\s+/i);
    assert.doesNotMatch(drafted.message, /how many leads|what'?s your (current )?crm|keyword research/i);
    assertNoConsulting(drafted.message);
    return drafted;
  }

  it("does not give website ideas — positions Acme Studio and sends the CTA", () => {
    const drafted = assertSellNotSolve("Can you give me ideas for my website?");
    assert.match(drafted.message, /kind of work we do|help you with/i);
    assert.doesNotMatch(drafted.message, /hero section|above the fold|add testimonials/i);
  });

  it("does not design automation — positions Acme Studio and sends the CTA", () => {
    const drafted = assertSellNotSolve("How should I automate my business?");
    assert.match(drafted.message, /automat/i);
    assert.doesNotMatch(drafted.message, /you could use|connect your crm/i);
  });

  it("does not write code — explains Acme Studio can build it and sends the CTA", () => {
    const drafted = assertSellNotSolve("Can you write this code for me?");
    assert.match(drafted.message, /custom software/i);
    assert.doesNotMatch(drafted.message, /here'?s (some )?code|const |function\s+/i);
  });

  it("does not recommend an AI tool — offers Acme Studio implementation and sends the CTA", () => {
    const drafted = assertSellNotSolve("What AI should I use?");
    assert.match(drafted.message, /implement ai|your business/i);
    assert.doesNotMatch(drafted.message, /chatgpt|claude|openai|gemini|you should use/i);
  });

  it("does not give an SEO strategy — offers Acme Studio SEO and sends the CTA", () => {
    const drafted = assertSellNotSolve("How can I improve my SEO?");
    assert.match(drafted.message, /seo/i);
    assert.doesNotMatch(drafted.message, /keyword research|backlink|schema markup/i);
  });

  it("does not design a SaaS in chat — high-level credibility then the CTA", () => {
    const drafted = assertSellNotSolve("How would you build this SaaS?");
    assert.match(drafted.message, /saas|custom software/i);
    assert.doesNotMatch(drafted.message, /architecture|microservices|postgres schema/i);
  });

  it("treats can you build this as yes plus a meeting CTA", () => {
    const analysis = analyzeConversationReply("Can you build this for us?");
    assert.equal(analysis.cue, "asked_for_help");
    assert.equal(decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true }).to, "LINK_SENT");
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      ctx,
      cue: analysis.cue,
      replyExcerpt: "Can you build this for us?",
    });
    assert.match(drafted.message, /your business/i);
    assert.match(drafted.message, /\/go\/linkedin/i);
    assertNoConsulting(drafted.message);
  });

  it("treats we need someone to handle our website as positioning plus CTA", () => {
    const analysis = analyzeConversationReply("We need someone to handle our website.");
    assert.equal(analysis.cue, "asked_for_help");
    assert.equal(analysis.match.service, "WEBSITE_DEVELOPMENT");
    assert.equal(decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true }).to, "LINK_SENT");
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      ctx,
      cue: analysis.cue,
      match: analysis.match,
      replyExcerpt: "We need someone to handle our website.",
    });
    assert.match(drafted.message, /your business/i);
    assert.match(drafted.message, /\/go\/linkedin/i);
    assertNoConsulting(drafted.message);
  });

  it("qualifies a sales-automation want without solving it", () => {
    const analysis = analyzeConversationReply("We want to automate our sales process.");
    assert.equal(analysis.match.service, "AI_AUTOMATION");
    assert.equal(analysis.cue, "problem");
    assert.equal(decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true }).to, "PITCH");
    const drafted = draftConversationMessage({
      stage: "PITCH",
      ctx,
      match: analysis.match,
      replyExcerpt: "We want to automate our sales process.",
    });
    assert.match(drafted.message, /your business/i);
    assert.match(drafted.message, /sales and workflow automation|automat/i);
    assert.doesNotMatch(drafted.message, /what crm|how many leads|n8n|hubspot/i);
    assert.doesNotMatch(drafted.message, /\/go\/linkedin/i);
    assertNoConsulting(drafted.message);
  });

  it("sends the meeting CTA when they say I'm interested", () => {
    const analysis = analyzeConversationReply("I'm interested.");
    const decision = decideConversationTransition({ from: "GETTING_TO_KNOW", analysis, connected: true });
    assert.equal(decision.to, "LINK_SENT");
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      ctx,
      cue: analysis.cue,
      replyExcerpt: "I'm interested.",
    });
    assert.match(drafted.message, /\/go\/linkedin/i);
  });

  it("refuses to map an automation design even when asked how we would do it", () => {
    const drafted = assertSellNotSolve("How would you automate our lead follow-up?");
    assert.match(drafted.message, /your business/i);
    assert.doesNotMatch(drafted.message, /if lead score|webhook|sequence delay/i);
  });
});

describe("operator commercial QA", () => {
  it("keeps a draft that makes hiring Acme Studio more likely", () => {
    const drafted = draftConversationMessage({
      stage: "LINK_SENT",
      ctx,
      cue: "meeting",
      replyExcerpt: "Let's talk.",
    });
    const review = reviewCommercialDraft({ message: drafted.message, stage: "LINK_SENT", cue: "meeting" });
    assert.equal(review.keep, true);
  });

  it("rejects teaching them to do the work themselves", () => {
    const review = reviewCommercialDraft({
      message: "You could use n8n with HubSpot. Here's how you can automate follow-up yourself.",
      stage: "PITCH",
      cue: "problem",
    });
    assert.equal(review.keep, false);
    assert.match(review.reason, /themselves/i);
  });

  it("rejects invented pain", () => {
    const review = reviewCommercialDraft({
      message: "I noticed you're struggling with operations. That bottleneck is costing you.",
      stage: "GETTING_TO_KNOW",
      cue: "casual",
    });
    assert.equal(review.keep, false);
    assert.match(review.reason, /invents a problem/i);
  });

  it("rejects unnecessary questions once a sale is on the table", () => {
    const review = reviewCommercialDraft({
      message: "What's your current CRM and how many leads do you get?",
      stage: "PITCH",
      cue: "problem",
    });
    assert.equal(review.keep, false);
    assert.match(review.reason, /unnecessary questions/i);
  });

  it("rejects chatting after they already asked to talk", () => {
    const review = reviewCommercialDraft({
      message: "Got you. What's taking most of your time lately?",
      stage: "DISCOVERY",
      cue: "meeting",
    });
    assert.equal(review.keep, false);
    assert.match(review.reason, /already interested|converting/i);
  });

  it("rejects a post-booking check-in or extra pitch", () => {
    const review = reviewCommercialDraft({
      message: "Just checking in — want to have a quick call about our services?",
      stage: "MEETING_BOOKED",
      cue: "booked",
    });
    assert.equal(review.keep, false);
    assert.match(review.reason, /already booked/i);
  });

  it("keeps a booking confirmation and nothing more", () => {
    const drafted = draftConversationMessage({ stage: "MEETING_BOOKED", ctx, cue: "booked" });
    const review = reviewCommercialDraft({ message: drafted.message, stage: "MEETING_BOOKED", cue: "booked" });
    assert.equal(review.keep, true);
    assert.doesNotMatch(drafted.message, /acme\.example|just checking in|following up/i);
  });
});

describe("pain to Acme Studio match", () => {
  const cases = [
    ["We get too many leads to handle manually.", "AI_AUTOMATION"],
    ["Our website doesn't convert.", "WEBSITE_DEVELOPMENT"],
    ["We're doing everything manually.", "AI_AUTOMATION"],
    ["We need a custom platform.", "FULL_STACK_DEVELOPMENT"],
    ["Our SEO isn't bringing clients.", "SEO"],
    ["We need an AI chatbot.", "AI_CHATBOTS"],
  ] as const;

  for (const [text, service] of cases) {
    it(`matches “${text}” to ${service}`, () => {
      const match = matchConversationPain(text);
      assert.equal(match.matched, true);
      assert.equal(match.service, service);
    });
  }
});

describe("conversation is not a send adapter", () => {
  it("still blocks LinkedIn sends", () => {
    assert.equal(
      canSendMessage({
        policy: { ...DEFAULT_OUTREACH_ENGINE, sendMode: "send_on_approve", sendsPaused: false },
        sentToday: 0,
        activeSequences: 0,
        auditVerdict: "PASS",
        auditedAt: new Date().toISOString(),
        leadStatus: "QUALIFIED",
        suppressed: false,
        unsubscribed: false,
        draftStatus: "APPROVED",
        channel: "LINKEDIN",
        gmailSendConnected: true,
        sequenceStatus: "ACTIVE",
      }).code,
      "SOCIAL_SEND_BLOCKED",
    );
  });
});

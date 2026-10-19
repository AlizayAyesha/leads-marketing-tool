import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LINKEDIN_MEETING_URL,
  attributedLinkedInMeetingUrl,
  forwardMeetingAttribution,
  isDuplicateMeetingStage,
  isLinkedInGoPath,
  meetingParamsFromSchedulerBody,
  parseMeetingAttribution,
  shouldHaltOutreachForMeeting,
  shouldSendMeetingLink,
} from "@/lib/conversation/booking";

describe("LinkedIn meeting CTA attribution", () => {
  it("stamps source=linkedin, lead, and conversation onto the CTA", () => {
    const url = attributedLinkedInMeetingUrl({ publicLeadId: "ZJ-01", conversationId: "conv-01" });
    assert.equal(url.startsWith(LINKEDIN_MEETING_URL), true);
    const parsed = parseMeetingAttribution(url);
    assert.equal(parsed.source, "LINKEDIN");
    assert.equal(parsed.sourceSurvived, true);
    assert.equal(parsed.publicLeadId, "ZJ-01");
    assert.equal(parsed.conversationId, "conv-01");
  });

  it("keeps source=linkedin through a Calendly redirect, including utm fields Calendly stores", () => {
    const inbound = parseMeetingAttribution(
      attributedLinkedInMeetingUrl({ publicLeadId: "ZJ-09", conversationId: "c9" }),
    );
    const forwarded = forwardMeetingAttribution("https://cal.example/jane/30min", inbound);
    const after = parseMeetingAttribution(forwarded);
    assert.equal(after.sourceSurvived, true);
    assert.equal(after.publicLeadId, "ZJ-09");
    assert.equal(after.conversationId, "c9");
    assert.match(forwarded, /cal\.example\/jane\/30min/);
    assert.match(forwarded, /utm_campaign=ZJ-09/);
    assert.match(forwarded, /utm_content=c9/);
  });

  it("reads Calendly webhook tracking when lead/cid query keys are absent", () => {
    const { event, params } = meetingParamsFromSchedulerBody({
      event: "invitee.created",
      payload: {
        tracking: {
          utm_source: "linkedin",
          utm_medium: "linkedin_dm",
          utm_campaign: "ZJ-09",
          utm_content: "c9",
        },
      },
    });
    assert.equal(event, "booked");
    const parsed = parseMeetingAttribution(params);
    assert.equal(parsed.sourceSurvived, true);
    assert.equal(parsed.publicLeadId, "ZJ-09");
    assert.equal(parsed.conversationId, "c9");
  });

  it("treats a second booked callback as a duplicate stage, not a new meeting", () => {
    assert.equal(isDuplicateMeetingStage("BOOKING_STARTED"), false);
    assert.equal(isDuplicateMeetingStage("MEETING_BOOKED"), true);
  });

  it("does not treat the go/linkedin hop as an external booking destination", () => {
    assert.equal(isLinkedInGoPath(LINKEDIN_MEETING_URL), true);
    assert.equal(isLinkedInGoPath("https://cal.example/jane/30min"), false);
  });

  it("does not send the CTA on a problem or an opening tell-me-more", () => {
    assert.equal(
      shouldSendMeetingLink({ from: "GETTING_TO_KNOW", cue: "problem", text: "Our website is slow." }),
      false,
    );
    assert.equal(
      shouldSendMeetingLink({ from: "GETTING_TO_KNOW", cue: "interested", text: "Interesting, tell me more." }),
      false,
    );
    assert.equal(
      shouldSendMeetingLink({ from: "PITCH", cue: "interested", text: "Tell me more." }),
      true,
    );
    assert.equal(
      shouldSendMeetingLink({ from: "GETTING_TO_KNOW", cue: "buying_intent", text: "How much does it cost?" }),
      true,
    );
  });

  it("halts outreach once the meeting is booked", () => {
    assert.equal(shouldHaltOutreachForMeeting("LINK_SENT"), false);
    assert.equal(shouldHaltOutreachForMeeting("BOOKING_STARTED"), false);
    assert.equal(shouldHaltOutreachForMeeting("MEETING_BOOKED"), true);
  });
});

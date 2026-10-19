import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canEnrollInSequence, canSendMessage } from "@/lib/outreach/gate";
import { PRODUCTION_SEND_EVIDENCE } from "@/lib/intelligence/send-invariant";
import { DEFAULT_OUTREACH_ENGINE, HARD_DAILY_SEND_LIMIT, HARD_MAX_ACTIVE_SEQUENCES, HARD_LINKEDIN_CONNECTION_DAILY_CAP, HARD_LINKEDIN_MESSAGE_DAILY_CAP, mergeOutreachEnginePolicy } from "@/lib/outreach/policy";
import { decideLinkedInConnectionTransition, isPostConnectionMessageDue } from "@/lib/linkedin/connection/machine";
import { getLinkedInConnectionStatusProvider, setLinkedInConnectionStatusProviderForTests } from "@/lib/linkedin/connection/registry";
import { UnavailableLinkedInConnectionStatusProvider, LINKEDIN_CONNECTION_STATUS_UNAVAILABLE } from "@/lib/linkedin/connection/unavailable-provider";
import { countLinkedInQuotaDrafts, countsTowardLinkedInDailyQuota, linkedInDailyQuota } from "@/lib/linkedin/connection/quota";
import type { ConnectionMachineInput, LinkedInConnectionStatus } from "@/lib/linkedin/connection/types";
import { resetChromeToolForTests } from "@/lib/tools/chrome";

const now = new Date();
const fresh = now;

function passInput(overrides: Partial<ConnectionMachineInput> = {}): ConnectionMachineInput {
  return {
    status: "NOT_REQUESTED",
    stopped: false,
    suppressed: false,
    leadStatus: "QUALIFIED",
    auditVerdict: "PASS",
    auditedAt: fresh,
    allowedChannels: ["LINKEDIN", "EMAIL"],
    linkedinUrlKind: "person",
    waitDays: 2,
    now,
    linkedinDraftsEnabled: true,
    ...overrides,
  };
}

const enrollBase = {
  policy: DEFAULT_OUTREACH_ENGINE,
  sentToday: 0,
  activeSequences: 0,
  auditVerdict: "PASS" as const,
  auditedAt: fresh,
  leadStatus: "QUALIFIED",
  suppressed: false,
  unsubscribed: false,
  draftStatus: "APPROVED" as const,
  channel: "EMAIL" as const,
  gmailSendConnected: true,
  sequenceStatus: "ACTIVE" as const,
};

const liveSend = {
  ...enrollBase,
  policy: { ...DEFAULT_OUTREACH_ENGINE, sendMode: "send_on_approve" as const, sendsPaused: false },
};

describe("LinkedIn connection lifecycle allowed transitions", () => {
  it("recommends a connection only after Decision Maker PASS on a person URL", () => {
    const decision = decideLinkedInConnectionTransition("recommend", passInput());
    assert.equal(decision.ok, true);
    assert.equal(decision.from, "NOT_REQUESTED");
    assert.equal(decision.to, "RECOMMENDED");
    assert.equal(decision.code, "RECOMMENDED");
  });

  it("moves RECOMMENDED to REQUEST_APPROVED on human approval", () => {
    const decision = decideLinkedInConnectionTransition("approve", passInput({ status: "RECOMMENDED" }));
    assert.equal(decision.ok, true);
    assert.equal(decision.to, "REQUEST_APPROVED");
  });

  it("moves REQUEST_APPROVED to REQUESTED only after the operator confirms they sent the invite", () => {
    const decision = decideLinkedInConnectionTransition("confirm_requested", passInput({ status: "REQUEST_APPROVED" }));
    assert.equal(decision.ok, true);
    assert.equal(decision.to, "REQUESTED");
    assert.notEqual(decision.to, "CONNECTED");
  });

  it("sets CONNECTED from REQUESTED only with an authorized configured provider", () => {
    const decision = decideLinkedInConnectionTransition(
      "apply_status",
      passInput({ status: "REQUESTED", providerConfigured: true, providerResult: "CONNECTED" }),
    );
    assert.equal(decision.ok, true);
    assert.equal(decision.to, "CONNECTED");
    assert.ok(decision.nextEligibleMessageAt);
    const waitMs = Date.parse(decision.nextEligibleMessageAt) - now.getTime();
    assert.equal(waitMs, 2 * 24 * 60 * 60 * 1000);
  });

  it("allows CONNECTED from UNKNOWN after an authorized check", () => {
    const decision = decideLinkedInConnectionTransition(
      "apply_status",
      passInput({ status: "UNKNOWN", providerConfigured: true, providerResult: "CONNECTED" }),
    );
    assert.equal(decision.ok, true);
    assert.equal(decision.to, "CONNECTED");
  });

  it("records DECLINED from REQUESTED with an authorized provider", () => {
    const decision = decideLinkedInConnectionTransition(
      "apply_status",
      passInput({ status: "REQUESTED", providerConfigured: true, providerResult: "DECLINED" }),
    );
    assert.equal(decision.ok, true);
    assert.equal(decision.to, "DECLINED");
  });

  it("recommends a post-connection message only after CONNECTED and the wait has elapsed", () => {
    const due = new Date(now.getTime() - 1000);
    const input = passInput({
      status: "CONNECTED",
      nextEligibleMessageAt: due,
      connectedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    });
    assert.equal(isPostConnectionMessageDue(input, now), true);
    const decision = decideLinkedInConnectionTransition("recommend_message", input);
    assert.equal(decision.ok, true);
    assert.equal(decision.to, "CONNECTED");
    assert.equal(decision.code, "MESSAGE_RECOMMENDED");
  });

  it("stops further recommendations on reply or DNC", () => {
    const decision = decideLinkedInConnectionTransition("stop", passInput({ status: "REQUESTED" }));
    assert.equal(decision.ok, true);
    assert.equal(decision.code, "STOPPED");
    assert.equal(decision.to, "REQUESTED");
  });
});

describe("LinkedIn connection lifecycle blocked transitions", () => {
  it("does not recommend without Decision Maker PASS", () => {
    for (const verdict of [null, "HOLD", "REJECT"] as const) {
      const decision = decideLinkedInConnectionTransition("recommend", passInput({ auditVerdict: verdict }));
      assert.equal(decision.ok, false);
      assert.equal(decision.to, "NOT_REQUESTED");
    }
  });

  it("does not recommend when a connection is already in progress", () => {
    assert.equal(
      decideLinkedInConnectionTransition("recommend", passInput({ status: "RECOMMENDED" })).code,
      "ALREADY_IN_PROGRESS",
    );
    assert.equal(
      decideLinkedInConnectionTransition("recommend", passInput({ status: "REQUESTED" })).code,
      "ALREADY_IN_PROGRESS",
    );
  });

  it("does not recommend when LinkedIn is not an allowed channel", () => {
    const decision = decideLinkedInConnectionTransition("recommend", passInput({ allowedChannels: ["EMAIL"] }));
    assert.equal(decision.ok, false);
    assert.equal(decision.code, "CHANNEL_NOT_ALLOWED");
  });

  it("does not recommend a company or missing LinkedIn URL", () => {
    assert.equal(decideLinkedInConnectionTransition("recommend", passInput({ linkedinUrlKind: "company" })).code, "NOT_PERSON_URL");
    assert.equal(decideLinkedInConnectionTransition("recommend", passInput({ linkedinUrlKind: "missing" })).code, "NOT_PERSON_URL");
  });

  it("does not recommend when LinkedIn drafts are disabled", () => {
    assert.equal(
      decideLinkedInConnectionTransition("recommend", passInput({ linkedinDraftsEnabled: false })).code,
      "CHANNEL_OFF",
    );
  });

  it("does not approve before a recommendation", () => {
    assert.equal(decideLinkedInConnectionTransition("approve", passInput()).code, "NOT_RECOMMENDED");
  });

  it("does not confirm REQUESTED before human approval", () => {
    assert.equal(
      decideLinkedInConnectionTransition("confirm_requested", passInput({ status: "RECOMMENDED" })).code,
      "NOT_APPROVED",
    );
    assert.equal(decideLinkedInConnectionTransition("confirm_requested", passInput()).code, "NOT_APPROVED");
  });

  it("never treats an unavailable provider as CONNECTED", () => {
    const decision = decideLinkedInConnectionTransition(
      "apply_status",
      passInput({ status: "REQUESTED", providerConfigured: false, providerResult: "UNKNOWN" }),
    );
    assert.equal(decision.ok, true);
    assert.equal(decision.to, "UNKNOWN");
    assert.equal(decision.code, "STATUS_UNAVAILABLE");
    assert.notEqual(decision.to, "CONNECTED");
  });

  it("never lets REQUESTED become CONNECTED automatically", () => {
    const pending = decideLinkedInConnectionTransition(
      "apply_status",
      passInput({ status: "REQUESTED", providerConfigured: true, providerResult: "PENDING" }),
    );
    assert.equal(pending.ok, true);
    assert.equal(pending.to, "REQUESTED");
    assert.equal(pending.code, "PENDING");
    assert.notEqual(pending.to, "CONNECTED");
    const unknown = decideLinkedInConnectionTransition(
      "apply_status",
      passInput({ status: "REQUESTED", providerConfigured: true, providerResult: "UNKNOWN" }),
    );
    assert.equal(unknown.to, "REQUESTED");
    assert.equal(unknown.code, "UNKNOWN");
    assert.notEqual(unknown.to, "CONNECTED");
  });

  it("sets CONNECTED from an authorized first-degree check, including already-connected profiles", () => {
    for (const status of ["REQUESTED", "UNKNOWN", "NOT_REQUESTED", "RECOMMENDED", "REQUEST_APPROVED"] as const) {
      const decision = decideLinkedInConnectionTransition(
        "apply_status",
        passInput({ status, providerConfigured: true, providerResult: "CONNECTED" }),
      );
      assert.equal(decision.ok, true, status);
      assert.equal(decision.to, "CONNECTED");
    }
  });

  it("does not treat UNKNOWN as CONNECTED for a post-connection message", () => {
    const due = new Date(now.getTime() - 1000);
    const decision = decideLinkedInConnectionTransition(
      "recommend_message",
      passInput({ status: "UNKNOWN", nextEligibleMessageAt: due }),
    );
    assert.equal(decision.ok, false);
    assert.equal(decision.code, "NOT_CONNECTED");
  });

  it("does not recommend a message from REQUESTED", () => {
    const due = new Date(now.getTime() - 1000);
    const decision = decideLinkedInConnectionTransition(
      "recommend_message",
      passInput({ status: "REQUESTED", nextEligibleMessageAt: due }),
    );
    assert.equal(decision.ok, false);
    assert.equal(decision.code, "NOT_CONNECTED");
  });

  it("enforces the post-connection wait", () => {
    const later = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const input = passInput({ status: "CONNECTED", nextEligibleMessageAt: later });
    assert.equal(isPostConnectionMessageDue(input, now), false);
    assert.equal(decideLinkedInConnectionTransition("recommend_message", input).code, "WAIT_PERIOD");
  });

  it("treats CONNECTED with no wait timestamp as due for first outreach", () => {
    const input = passInput({ status: "CONNECTED", nextEligibleMessageAt: null });
    assert.equal(isPostConnectionMessageDue(input, now), true);
    assert.equal(decideLinkedInConnectionTransition("recommend_message", input).ok, true);
  });

  it("keeps already-CONNECTED status checks eligible for outreach", () => {
    const decision = decideLinkedInConnectionTransition(
      "apply_status",
      passInput({
        status: "CONNECTED",
        providerConfigured: true,
        providerResult: "CONNECTED",
        nextEligibleMessageAt: null,
      }),
    );
    assert.equal(decision.ok, true);
    assert.equal(decision.to, "CONNECTED");
    assert.ok(decision.nextEligibleMessageAt);
  });

  it("messages existing network immediately when synced from NOT_REQUESTED", () => {
    const decision = decideLinkedInConnectionTransition(
      "apply_status",
      passInput({
        status: "NOT_REQUESTED",
        providerConfigured: true,
        providerResult: "CONNECTED",
      }),
    );
    assert.equal(decision.to, "CONNECTED");
    assert.ok(decision.nextEligibleMessageAt);
    assert.ok(Date.parse(decision.nextEligibleMessageAt!) <= now.getTime() + 1000);
  });

  it("does not recommend another message when a draft already exists", () => {
    const due = new Date(now.getTime() - 1000);
    assert.equal(
      decideLinkedInConnectionTransition(
        "recommend_message",
        passInput({ status: "CONNECTED", nextEligibleMessageAt: due, hasPendingMessageDraft: true }),
      ).code,
      "DRAFT_EXISTS",
    );
  });

  it("forbids a manual mark CONNECTED action from every status", () => {
    const statuses: LinkedInConnectionStatus[] = [
      "NOT_REQUESTED",
      "RECOMMENDED",
      "REQUEST_APPROVED",
      "REQUESTED",
      "CONNECTED",
      "DECLINED",
      "UNKNOWN",
    ];
    for (const status of statuses) {
      const decision = decideLinkedInConnectionTransition("mark_connected", passInput({ status }));
      assert.equal(decision.ok, false);
      assert.equal(decision.code, "MARK_CONNECTED_FORBIDDEN");
      assert.equal(decision.from, status);
      if (status !== "CONNECTED") assert.notEqual(decision.to, "CONNECTED");
    }
  });

  it("blocks further recommendations after the lifecycle is stopped", () => {
    const stopped = passInput({ status: "RECOMMENDED", stopped: true });
    assert.equal(decideLinkedInConnectionTransition("approve", stopped).code, "LIFECYCLE_STOPPED");
    assert.equal(decideLinkedInConnectionTransition("recommend", passInput({ stopped: true })).code, "LIFECYCLE_STOPPED");
    const due = new Date(now.getTime() - 1000);
    assert.equal(
      decideLinkedInConnectionTransition(
        "recommend_message",
        passInput({ status: "CONNECTED", stopped: true, nextEligibleMessageAt: due }),
      ).code,
      "LIFECYCLE_STOPPED",
    );
  });

  it("does not recommend when the lead is suppressed or do-not-contact", () => {
    assert.equal(decideLinkedInConnectionTransition("recommend", passInput({ suppressed: true })).code, "SUPPRESSED");
    assert.equal(
      decideLinkedInConnectionTransition("recommend", passInput({ leadStatus: "DO_NOT_CONTACT" })).code,
      "SUPPRESSED",
    );
  });
});

describe("LinkedIn connection status provider v1", () => {
  it("defaults to unavailable and never reports CONNECTED", async () => {
    resetChromeToolForTests();
    setLinkedInConnectionStatusProviderForTests(null);
    const provider = getLinkedInConnectionStatusProvider();
    assert.equal(provider.configured, false);
    const result = await provider.fetchStatus({
      profileUrl: "https://www.linkedin.com/in/example",
      normalizedUrl: "https://www.linkedin.com/in/example",
    });
    assert.equal(result.result, "UNKNOWN");
    assert.equal(result.code, LINKEDIN_CONNECTION_STATUS_UNAVAILABLE);
    assert.notEqual(result.result, "CONNECTED");
  });

  it("stays unavailable when Chrome is disconnected even if a status env name is set", () => {
    resetChromeToolForTests();
    const previous = process.env.LINKEDIN_CONNECTION_STATUS_PROVIDER;
    process.env.LINKEDIN_CONNECTION_STATUS_PROVIDER = "official";
    try {
      setLinkedInConnectionStatusProviderForTests(null);
      assert.equal(getLinkedInConnectionStatusProvider().configured, false);
      assert.ok(getLinkedInConnectionStatusProvider() instanceof UnavailableLinkedInConnectionStatusProvider);
    } finally {
      if (previous === undefined) delete process.env.LINKEDIN_CONNECTION_STATUS_PROVIDER;
      else process.env.LINKEDIN_CONNECTION_STATUS_PROVIDER = previous;
    }
  });
});

describe("authorized daily send transition", () => {
  it("records REQUESTED after an authorized send and never CONNECTED", () => {
    const decision = decideLinkedInConnectionTransition("record_authorized_send", passInput());
    assert.equal(decision.ok, true);
    assert.equal(decision.to, "REQUESTED");
    assert.notEqual(decision.to, "CONNECTED");
  });

  it("does not let UNKNOWN become REQUESTED or CONNECTED via authorized send", () => {
    const decision = decideLinkedInConnectionTransition("record_authorized_send", passInput({ status: "UNKNOWN" }));
    assert.equal(decision.ok, false);
    assert.notEqual(decision.to, "CONNECTED");
  });
});

describe("existing outreach protections stay in force", () => {
  it("keeps kill switch, draft_only, and caps", () => {
    assert.equal(DEFAULT_OUTREACH_ENGINE.sendsPaused, true);
    assert.equal(DEFAULT_OUTREACH_ENGINE.sendMode, "draft_only");
    assert.ok(DEFAULT_OUTREACH_ENGINE.dailySendLimit <= HARD_DAILY_SEND_LIMIT);
    assert.equal(DEFAULT_OUTREACH_ENGINE.maxActiveSequences, HARD_MAX_ACTIVE_SEQUENCES);
    assert.equal(HARD_DAILY_SEND_LIMIT, 100);
    assert.equal(HARD_MAX_ACTIVE_SEQUENCES, 250);
    assert.equal(DEFAULT_OUTREACH_ENGINE.postConnectionWaitDays, 2);
    const tampered = mergeOutreachEnginePolicy({ dailySendLimit: 999, maxActiveSequences: 999, postConnectionWaitDays: 90, linkedinConnectionDailyCap: 999, linkedinMessageDailyCap: 999 });
    assert.equal(tampered.dailySendLimit, HARD_DAILY_SEND_LIMIT);
    assert.equal(tampered.maxActiveSequences, HARD_MAX_ACTIVE_SEQUENCES);
    assert.equal(tampered.postConnectionWaitDays, 30);
    assert.equal(tampered.linkedinConnectionDailyCap, HARD_LINKEDIN_CONNECTION_DAILY_CAP);
    assert.equal(tampered.linkedinMessageDailyCap, HARD_LINKEDIN_MESSAGE_DAILY_CAP);
    assert.equal(tampered.sendMode, "draft_only");
    assert.equal(tampered.sendsPaused, true);
    assert.ok(DEFAULT_OUTREACH_ENGINE.linkedinConnectionDailyCap <= HARD_LINKEDIN_CONNECTION_DAILY_CAP);
    assert.ok(DEFAULT_OUTREACH_ENGINE.linkedinMessageDailyCap <= HARD_LINKEDIN_MESSAGE_DAILY_CAP);
  });

  it("still blocks LinkedIn and Instagram sends", () => {
    assert.equal(canSendMessage({ ...liveSend, channel: "LINKEDIN" }).code, "SOCIAL_SEND_BLOCKED");
    assert.equal(canSendMessage({ ...liveSend, channel: "INSTAGRAM" }).code, "SOCIAL_SEND_BLOCKED");
  });

  it("does not enroll LinkedIn in a cold send sequence, and leaves email unchanged", () => {
    assert.equal(canEnrollInSequence(enrollBase).ok, true);
    assert.equal(canEnrollInSequence({ ...enrollBase, channel: "LINKEDIN" }).code, "LINKEDIN_CONNECTION_LIFECYCLE");
    assert.equal(canEnrollInSequence({ ...enrollBase, channel: "INSTAGRAM" }).ok, true);
  });
});

describe("LinkedIn daily quota", () => {
  it("tracks connections and messages separately and reports remaining", () => {
    const quota = linkedInDailyQuota({ connectionsToday: 6, messagesToday: 4 });
    assert.equal(quota.connectionsToday, 6);
    assert.equal(quota.messagesToday, 4);
    assert.equal(quota.connectionCap, HARD_LINKEDIN_CONNECTION_DAILY_CAP);
    assert.equal(quota.messageCap, HARD_LINKEDIN_MESSAGE_DAILY_CAP);
    assert.equal(quota.connectionsRemaining, HARD_LINKEDIN_CONNECTION_DAILY_CAP - 6);
    assert.equal(quota.messagesRemaining, HARD_LINKEDIN_MESSAGE_DAILY_CAP - 4);
  });

  it("does not count rejected or superseded recommendations toward the cap", () => {
    assert.equal(countsTowardLinkedInDailyQuota("PENDING_APPROVAL"), true);
    assert.equal(countsTowardLinkedInDailyQuota("APPROVED"), true);
    assert.equal(countsTowardLinkedInDailyQuota("REJECTED"), false);
    assert.equal(countsTowardLinkedInDailyQuota("SUPERSEDED"), false);
    assert.equal(
      countLinkedInQuotaDrafts([
        { status: "PENDING_APPROVAL" },
        { status: "APPROVED" },
        { status: "REJECTED" },
        { status: "SUPERSEDED" },
      ]),
      2,
    );
  });

  it("blocks the next connection recommendation and message when the daily cap is full", () => {
    const connect = decideLinkedInConnectionTransition(
      "recommend",
      passInput({ connectionsToday: HARD_LINKEDIN_CONNECTION_DAILY_CAP }),
    );
    assert.equal(connect.ok, false);
    assert.equal(connect.code, "LINKEDIN_CONNECTION_DAILY_CAP");
    assert.equal(
      decideLinkedInConnectionTransition(
        "recommend",
        passInput({ connectionsToday: HARD_LINKEDIN_CONNECTION_DAILY_CAP - 1 }),
      ).ok,
      true,
    );
    const due = new Date(now.getTime() - 1000);
    const message = decideLinkedInConnectionTransition(
      "recommend_message",
      passInput({
        status: "CONNECTED",
        nextEligibleMessageAt: due,
        messagesToday: HARD_LINKEDIN_MESSAGE_DAILY_CAP,
      }),
    );
    assert.equal(message.ok, false);
    assert.equal(message.code, "LINKEDIN_MESSAGE_DAILY_CAP");
    assert.equal(
      decideLinkedInConnectionTransition(
        "recommend_message",
        passInput({
          status: "CONNECTED",
          nextEligibleMessageAt: due,
          messagesToday: HARD_LINKEDIN_MESSAGE_DAILY_CAP - 1,
        }),
      ).ok,
      true,
    );
  });

  it("lets a rejected slot be reused the same day", () => {
    const afterReject = linkedInDailyQuota({
      connectionsToday: countLinkedInQuotaDrafts([
        { status: "PENDING_APPROVAL" },
        { status: "PENDING_APPROVAL" },
        { status: "REJECTED" },
      ]),
      messagesToday: 0,
    });
    assert.equal(afterReject.connectionsToday, 2);
    assert.equal(afterReject.connectionsRemaining, HARD_LINKEDIN_CONNECTION_DAILY_CAP - 2);
    assert.equal(
      decideLinkedInConnectionTransition("recommend", passInput({ connectionsToday: afterReject.connectionsToday })).ok,
      true,
    );
  });

  it("keeps LinkedIn quota separate from email send limits", () => {
    assert.ok(DEFAULT_OUTREACH_ENGINE.dailySendLimit <= HARD_DAILY_SEND_LIMIT);
    assert.ok(DEFAULT_OUTREACH_ENGINE.linkedinConnectionDailyCap <= HARD_LINKEDIN_CONNECTION_DAILY_CAP);
    assert.equal(HARD_DAILY_SEND_LIMIT, HARD_LINKEDIN_CONNECTION_DAILY_CAP);
    const live = {
      policy: { ...DEFAULT_OUTREACH_ENGINE, sendMode: "send_on_approve" as const, sendsPaused: false },
      sentToday: 0,
      activeSequences: 0,
      auditVerdict: "PASS" as const,
      auditedAt: now,
      leadStatus: "QUALIFIED",
      suppressed: false,
      unsubscribed: false,
      draftStatus: "APPROVED" as const,
      channel: "EMAIL" as const,
      gmailSendConnected: true,
      sequenceStatus: "ACTIVE" as const,
      ...PRODUCTION_SEND_EVIDENCE,
    };
    assert.equal(canSendMessage(live).ok, true);
    assert.equal(canSendMessage({ ...live, channel: "LINKEDIN" }).code, "SOCIAL_SEND_BLOCKED");
  });
});

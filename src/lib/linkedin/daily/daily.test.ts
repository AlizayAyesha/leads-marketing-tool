import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldHaltOutreachForMeeting } from "@/lib/conversation/booking";
import { decideLinkedInConnectionTransition } from "@/lib/linkedin/connection/machine";
import {
  linkedInProspectEligibility,
  rankLinkedInProspects,
  type LinkedInProspectCandidate,
  type RankedLinkedInProspect,
} from "@/lib/linkedin/connection/ranking";
import { authorizeLinkedInDailyOutreach } from "@/lib/linkedin/daily/authorize";
import { runLinkedInDailyOutreach, skipLinkedInDailyCandidate, withLinkedInDailyLock } from "@/lib/linkedin/daily/run";
import { UnavailableLinkedInSendProvider } from "@/lib/linkedin/send/unavailable";
import type { LinkedInSendProvider, LinkedInSendRequest, LinkedInSendResult } from "@/lib/linkedin/send/types";
import { LINKEDIN_SEND_UNAVAILABLE } from "@/lib/linkedin/send/types";
import {
  DEFAULT_OUTREACH_ENGINE,
  HARD_LINKEDIN_CONNECTION_DAILY_CAP,
  HARD_LINKEDIN_MESSAGE_DAILY_CAP,
  mergeOutreachEnginePolicy,
} from "@/lib/outreach/policy";
import { canSendMessage } from "@/lib/outreach/gate";

const now = new Date();
const PERSON = "https://www.linkedin.com/in/ada-lovelace/";

function policy(overrides: Partial<typeof DEFAULT_OUTREACH_ENGINE> = {}) {
  return mergeOutreachEnginePolicy({
    ...DEFAULT_OUTREACH_ENGINE,
    sendsPaused: false,
    linkedinDailyOutreach: true,
    linkedinDrafts: true,
    ...overrides,
  });
}

function candidate(overrides: Partial<LinkedInProspectCandidate> = {}): LinkedInProspectCandidate {
  return {
    id: overrides.id ?? "id-1",
    leadId: overrides.leadId ?? "ZJ-1",
    name: "Ada",
    company: "Analytical Engines",
    linkedinUrl: PERSON,
    qualificationScore: 80,
    temperature: "HOT",
    auditVerdict: "PASS",
    auditedAt: now,
    allowedChannels: ["LINKEDIN", "EMAIL"],
    suppressed: false,
    leadStatus: "QUALIFIED",
    linkedinUrlKind: "person",
    connectionStatus: "NOT_REQUESTED",
    stopped: false,
    rejectedToday: false,
    linkedinResearchStatus: "AVAILABLE",
    hasOpportunity: true,
    hasPendingDraft: false,
    roleTitle: "Founder",
    serviceNeedStatus: "PASS",
    opportunitySelection: "PRIORITY",
    ...overrides,
  };
}

function ranked(overrides: Partial<LinkedInProspectCandidate> = {}): RankedLinkedInProspect & LinkedInProspectCandidate {
  const row = candidate(overrides);
  return {
    ...row,
    name: row.name ?? null,
    company: row.company ?? null,
    linkedinUrl: row.linkedinUrl ?? null,
    rank: 1,
    rankScore: 90,
    qualificationScore: row.qualificationScore ?? 80,
    temperature: row.temperature ?? null,
    connectionStatus: String(row.connectionStatus ?? "NOT_REQUESTED"),
    researchStatus: row.linkedinResearchStatus ?? null,
    reasons: ["qualified"],
    purpose: row.connectionStatus === "CONNECTED" ? "message" : "connection",
  };
}

function recordingProvider(opts: {
  configured?: boolean;
  failLeadIds?: Set<string>;
  rateLimitAfter?: number;
  delayMs?: number;
} = {}) {
  const calls: LinkedInSendRequest[] = [];
  const provider: LinkedInSendProvider = {
    id: "test-official",
    configured: opts.configured ?? true,
    async send(request) {
      if (opts.delayMs) await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
      calls.push(request);
      if (opts.rateLimitAfter && calls.length > opts.rateLimitAfter) {
        return {
          ok: false,
          sent: false,
          code: "RATE_LIMITED",
          reason: "Provider asked Jarvis to pause.",
          provider: "test-official",
          externalId: null,
        } satisfies LinkedInSendResult;
      }
      if (opts.failLeadIds?.has(request.leadId)) {
        return {
          ok: false,
          sent: false,
          code: "SEND_FAILED",
          reason: "Provider rejected the send.",
          provider: "test-official",
          externalId: null,
        };
      }
      return {
        ok: true,
        sent: true,
        code: "SENT",
        reason: "Accepted",
        provider: "test-official",
        externalId: `ext-${request.leadId}`,
      };
    },
  };
  return { provider, calls };
}

describe("LinkedIn Daily Outreach authorization", () => {
  it("defaults OFF and does not change email send policy", () => {
    assert.equal(DEFAULT_OUTREACH_ENGINE.linkedinDailyOutreach, false);
    assert.equal(DEFAULT_OUTREACH_ENGINE.sendsPaused, true);
    assert.equal(DEFAULT_OUTREACH_ENGINE.sendMode, "draft_only");
    assert.equal(
      canSendMessage({
        policy: { ...DEFAULT_OUTREACH_ENGINE, sendsPaused: false, sendMode: "send_on_approve" },
        sentToday: 0,
        activeSequences: 0,
        auditVerdict: "PASS",
        auditedAt: now,
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

  it("OFF sends nothing", async () => {
    const { provider, calls } = recordingProvider();
    const result = await runLinkedInDailyOutreach({
      policy: policy({ linkedinDailyOutreach: false }),
      sendProvider: provider,
      connections: [ranked()],
      messages: [],
      counters: { connectionsSent: 0, messagesSent: 0 },
      now,
    });
    assert.equal(result.canSend, false);
    assert.equal(result.connectionsSent, 0);
    assert.equal(calls.length, 0);
  });

  it("global kill switch overrides ON", async () => {
    const { provider, calls } = recordingProvider();
    const result = await runLinkedInDailyOutreach({
      policy: policy({ sendsPaused: true, linkedinDailyOutreach: true }),
      sendProvider: provider,
      connections: [ranked()],
      messages: [],
      counters: { connectionsSent: 0, messagesSent: 0 },
      now,
    });
    assert.equal(result.code, "KILL_SWITCH");
    assert.equal(result.connectionsSent, 0);
    assert.equal(calls.length, 0);
  });

  it("unavailable provider fails closed and never pretends success", async () => {
    const provider = new UnavailableLinkedInSendProvider();
    const result = await runLinkedInDailyOutreach({
      policy: policy(),
      sendProvider: provider,
      connections: [ranked()],
      messages: [],
      counters: { connectionsSent: 0, messagesSent: 0 },
      now,
    });
    assert.equal(result.canSend, false);
    assert.equal(result.code, LINKEDIN_SEND_UNAVAILABLE);
    assert.equal(result.connectionsSent, 0);
    assert.equal(result.sent.length, 0);
    assert.match(result.reason, /unavailable/i);
  });
});

describe("LinkedIn Daily Outreach caps and qualification", () => {
  it("ON processes eligible prospects up to the hard daily cap", async () => {
    const { provider, calls } = recordingProvider();
    const connections = Array.from({ length: HARD_LINKEDIN_CONNECTION_DAILY_CAP + 2 }, (_, index) =>
      ranked({ id: `id-${index}`, leadId: `ZJ-${index}`, qualificationScore: 70 + (index % 20) }),
    );
    const rankedConnections = rankLinkedInProspects(connections, {
      purpose: "connection_send",
      limit: HARD_LINKEDIN_CONNECTION_DAILY_CAP,
      now,
    });
    const byId = new Map(connections.map((row) => [row.id, row]));
    const result = await runLinkedInDailyOutreach({
      policy: policy({ linkedinConnectionDailyCap: HARD_LINKEDIN_CONNECTION_DAILY_CAP }),
      sendProvider: provider,
      connections: rankedConnections.map((row) => ({ ...(byId.get(row.id) ?? row), ...row })),
      messages: [],
      counters: { connectionsSent: 0, messagesSent: 0 },
      now,
    });
    assert.equal(result.connectionsSent, HARD_LINKEDIN_CONNECTION_DAILY_CAP);
    assert.equal(calls.length, HARD_LINKEDIN_CONNECTION_DAILY_CAP);
    assert.ok(result.sent.every((row) => row.nextStatus === "REQUESTED"));
  });

  it("does not invent extra prospects when fewer than the cap qualify", async () => {
    const { provider, calls } = recordingProvider();
    const connections = [ranked({ id: "a", leadId: "ZJ-A" }), ranked({ id: "b", leadId: "ZJ-B" }), ranked({ id: "c", leadId: "ZJ-C" })];
    const result = await runLinkedInDailyOutreach({
      policy: policy(),
      sendProvider: provider,
      connections,
      messages: [],
      counters: { connectionsSent: 0, messagesSent: 0 },
      now,
    });
    assert.equal(result.qualifiedConnections, 3);
    assert.equal(result.connectionsSent, 3);
    assert.equal(calls.length, 3);
  });

  it("caps LinkedIn messages at the hard daily cap independently", async () => {
    const { provider, calls } = recordingProvider();
    const due = new Date(now.getTime() - 1000);
    const messages = Array.from({ length: HARD_LINKEDIN_MESSAGE_DAILY_CAP + 2 }, (_, index) =>
      ranked({
        id: `m-${index}`,
        leadId: `ZJ-M-${index}`,
        connectionStatus: "CONNECTED",
        nextEligibleMessageAt: due,
      }),
    );
    const result = await runLinkedInDailyOutreach({
      policy: policy({ linkedinMessageDailyCap: HARD_LINKEDIN_MESSAGE_DAILY_CAP }),
      sendProvider: provider,
      connections: [],
      messages,
      counters: { connectionsSent: 0, messagesSent: 0 },
      now,
    });
    assert.equal(result.messagesSent, HARD_LINKEDIN_MESSAGE_DAILY_CAP);
    assert.equal(calls.filter((call) => call.kind === "message").length, HARD_LINKEDIN_MESSAGE_DAILY_CAP);
  });

  it("messages existing CONNECTED leads before new connection invites", async () => {
    const { provider, calls } = recordingProvider();
    const due = new Date(now.getTime() - 1000);
    const result = await runLinkedInDailyOutreach({
      policy: policy(),
      sendProvider: provider,
      connections: [ranked({ id: "c1", leadId: "ZJ-C1" })],
      messages: [
        ranked({
          id: "m1",
          leadId: "ZJ-M1",
          connectionStatus: "CONNECTED",
          nextEligibleMessageAt: due,
        }),
      ],
      counters: { connectionsSent: 0, messagesSent: 0 },
      now,
    });
    assert.equal(result.messagesSent, 1);
    assert.equal(result.connectionsSent, 1);
    assert.equal(calls[0]?.kind, "message");
    assert.equal(calls[1]?.kind, "connection");
  });

  it("does not send a connected-only message to REQUESTED or UNKNOWN", async () => {
    const { provider, calls } = recordingProvider();
    const result = await runLinkedInDailyOutreach({
      policy: policy(),
      sendProvider: provider,
      connections: [],
      messages: [
        ranked({ id: "r", leadId: "ZJ-REQ", connectionStatus: "REQUESTED" }),
        ranked({ id: "u", leadId: "ZJ-UNK", connectionStatus: "UNKNOWN" }),
      ],
      counters: { connectionsSent: 0, messagesSent: 0 },
      now,
    });
    assert.equal(result.messagesSent, 0);
    assert.equal(calls.length, 0);
    assert.equal(result.skipped.every((row) => row.code === "NOT_CONNECTED"), true);
  });
});

describe("LinkedIn Daily Outreach safety", () => {
  it("blocks duplicates for the same lead/action/day", async () => {
    const { provider, calls } = recordingProvider();
    const attempted = new Set<string>();
    const prospect = ranked();
    const first = await runLinkedInDailyOutreach({
      policy: policy(),
      sendProvider: provider,
      connections: [prospect],
      messages: [],
      counters: { connectionsSent: 0, messagesSent: 0 },
      attempted,
      now,
    });
    const second = await runLinkedInDailyOutreach({
      policy: policy(),
      sendProvider: provider,
      connections: [prospect],
      messages: [],
      counters: { connectionsSent: first.connectionsSent, messagesSent: 0 },
      attempted,
      now,
    });
    assert.equal(first.connectionsSent, 1);
    assert.equal(second.connectionsSent, 0);
    assert.equal(second.skipped.some((row) => row.code === "DUPLICATE"), true);
    assert.equal(calls.length, 1);
  });

  it("does not consume a slot when the provider does not confirm the send", async () => {
    const prospect = ranked({ id: "fail", leadId: "ZJ-FAIL" });
    const next = ranked({ id: "ok", leadId: "ZJ-OK" });
    const { provider, calls } = recordingProvider({ failLeadIds: new Set(["fail"]) });
    const counters = { connectionsSent: 0, messagesSent: 0 };
    const result = await runLinkedInDailyOutreach({
      policy: policy(),
      sendProvider: provider,
      connections: [prospect, next],
      messages: [],
      counters,
      now,
    });
    assert.equal(result.connectionsSent, 1);
    assert.equal(counters.connectionsSent, 1);
    assert.equal(result.sent[0].leadId, "ZJ-OK");
    assert.equal(calls.length, 2);
  });

  it("resets the daily counter on a new local day", async () => {
    const { provider } = recordingProvider();
    const attempted = new Set<string>();
    const prospect = ranked();
    const day1 = await runLinkedInDailyOutreach({
      policy: policy(),
      sendProvider: provider,
      connections: [prospect],
      messages: [],
      counters: { connectionsSent: 0, messagesSent: 0 },
      attempted,
      now,
    });
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const day2 = await runLinkedInDailyOutreach({
      policy: policy(),
      sendProvider: provider,
      connections: [prospect],
      messages: [],
      counters: { connectionsSent: 0, messagesSent: 0 },
      attempted,
      now: tomorrow,
    });
    assert.equal(day1.connectionsSent, 1);
    assert.equal(day2.connectionsSent, 1);
  });

  it("concurrent workers cannot exceed the connection cap", async () => {
    const { provider } = recordingProvider({ delayMs: 5 });
    const counters = { connectionsSent: 0, messagesSent: 0 };
    const attempted = new Set<string>();
    const capped = policy({ linkedinConnectionDailyCap: 10 });
    const batchA = Array.from({ length: 8 }, (_, index) => ranked({ id: `a-${index}`, leadId: `ZJ-A-${index}` }));
    const batchB = Array.from({ length: 8 }, (_, index) => ranked({ id: `b-${index}`, leadId: `ZJ-B-${index}` }));
    await Promise.all([
      withLinkedInDailyLock(() =>
        runLinkedInDailyOutreach({
          policy: capped,
          sendProvider: provider,
          connections: batchA,
          messages: [],
          counters,
          attempted,
          now,
        }),
      ),
      withLinkedInDailyLock(() =>
        runLinkedInDailyOutreach({
          policy: capped,
          sendProvider: provider,
          connections: batchB,
          messages: [],
          counters,
          attempted,
          now,
        }),
      ),
    ]);
    assert.equal(counters.connectionsSent, 10);
  });

  it("DNC, rejection, and a booked meeting skip immediately", () => {
    assert.equal(skipLinkedInDailyCandidate(ranked({ leadStatus: "DO_NOT_CONTACT" }), "connection", now)?.code, "DNC");
    assert.equal(skipLinkedInDailyCandidate(ranked({ auditVerdict: "REJECT" }), "connection", now)?.code, "REJECTED");
    assert.equal(
      skipLinkedInDailyCandidate(ranked({ conversationStage: "MEETING_BOOKED" }), "connection", now)?.code,
      "MEETING_BOOKED",
    );
    assert.equal(shouldHaltOutreachForMeeting("MEETING_BOOKED"), true);
    assert.equal(linkedInProspectEligibility(candidate({ leadStatus: "DO_NOT_CONTACT" }), "connection", now).ok, false);
  });

  it("UNKNOWN cannot become CONNECTED via authorized send", () => {
    const decision = decideLinkedInConnectionTransition("record_authorized_send", {
      status: "UNKNOWN",
      suppressed: false,
      leadStatus: "QUALIFIED",
      auditVerdict: "PASS",
      auditedAt: now,
      allowedChannels: ["LINKEDIN"],
      linkedinUrlKind: "person",
      now,
      linkedinDraftsEnabled: true,
    });
    assert.equal(decision.ok, false);
    assert.notEqual(decision.to, "CONNECTED");
    const requested = decideLinkedInConnectionTransition("record_authorized_send", {
      status: "NOT_REQUESTED",
      suppressed: false,
      leadStatus: "QUALIFIED",
      auditVerdict: "PASS",
      auditedAt: now,
      allowedChannels: ["LINKEDIN"],
      linkedinUrlKind: "person",
      now,
      linkedinDraftsEnabled: true,
    });
    assert.equal(requested.ok, true);
    assert.equal(requested.to, "REQUESTED");
    assert.notEqual(requested.to, "CONNECTED");
  });
});

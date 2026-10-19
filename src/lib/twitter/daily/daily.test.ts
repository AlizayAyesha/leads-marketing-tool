import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { authorizeTwitterDailyOutreach, twitterDailyIdempotencyKey } from "@/lib/twitter/daily/authorize";
import { composeTwitterDm } from "@/lib/twitter/daily/copy";
import { runTwitterDailyOutreach, skipTwitterDailyCandidate } from "@/lib/twitter/daily/run";
import { executeTwitterDm } from "@/lib/twitter/session/actions";
import { inspectTwitterPage } from "@/lib/twitter/session/inspect";
import type { TwitterBrowserPage } from "@/lib/browser/twitter-page";
import type { TwitterSendProvider } from "@/lib/twitter/send/types";
import { DEFAULT_OUTREACH_ENGINE } from "@/lib/outreach/policy";

function fakePage(input: {
  text?: string;
  url?: string;
  buttons?: Partial<Record<"Message" | "Follow" | "Following" | "Send", boolean>>;
  composerOk?: boolean;
  confirmText?: boolean;
  chatOk?: boolean;
  /** Simulate stuck New message recipient search (no composer yet). */
  stillOnSearch?: boolean;
}): TwitterBrowserPage {
  const buttons = {
    Message: false,
    Follow: false,
    Following: false,
    Send: false,
    ...(input.buttons ?? {}),
  };
  let bodyText = input.text ?? "";
  let onChat = false;
  let onMessages = false;
  const matchButton = (name: RegExp) => {
    if (/message/i.test(name.source) && !/new message/i.test(name.source)) return "Message" as const;
    if (/follow/i.test(name.source) && !/unfollow|following/i.test(name.source)) return "Follow" as const;
    if (/following|unfollow/i.test(name.source)) return "Following" as const;
    if (/send/i.test(name.source)) return "Send" as const;
    return null;
  };
  const composerReady = () => input.composerOk !== false && !input.stillOnSearch;
  return {
    url: () => {
      if (onChat) return "https://x.com/i/chat";
      if (onMessages) return "https://x.com/messages";
      return input.url ?? "https://x.com/ops_founder";
    },
    title: async () => "X",
    goto: async (url) => {
      onChat = /i\/chat/i.test(url);
      onMessages = /\/messages/i.test(url);
      return url;
    },
    innerText: async () => bodyText,
    screenshot: async () => null,
    hasVisibleButton: async (name) => {
      const label = matchButton(name);
      return Boolean(label && buttons[label]);
    },
    clickButton: async (name) => {
      if (/new chat|new message/i.test(name.source) && input.chatOk) return true;
      if (/ops_founder|@ops_founder/i.test(name.source) && input.chatOk) return true;
      if (/^next$/i.test(name.source)) {
        if (input.stillOnSearch) return true;
        if (input.chatOk) {
          onChat = true;
          return true;
        }
        return true;
      }
      if (name.source.includes("Follow") && !name.source.includes("Unfollow") && buttons.Follow) {
        buttons.Follow = false;
        buttons.Following = true;
        buttons.Message = true;
        return true;
      }
      if (name.source.includes("Message") && buttons.Message) {
        onMessages = true;
        return true;
      }
      if (name.source.includes("Send") && (buttons.Send || input.chatOk)) {
        if (input.confirmText !== false) {
          bodyText = `${bodyText}\nHi there — Saw you're looking for a web developer. Acme Studio can help.`;
        }
        return true;
      }
      return false;
    },
    hasScopedButton: async (_scope, name) => {
      const label = matchButton(name);
      return Boolean(label && buttons[label]);
    },
    clickScopedButton: async (_scope, name) => {
      const label = matchButton(name);
      if (label === "Follow" && buttons.Follow) {
        buttons.Follow = false;
        buttons.Following = true;
        buttons.Message = true;
        return true;
      }
      if (label === "Message" && buttons.Message) {
        onMessages = true;
        return true;
      }
      if (input.chatOk && /ops_founder/i.test(name.source)) return true;
      return false;
    },
    fillComposer: async () => composerReady(),
    fillPlaceholder: async (pattern) => {
      if (/search/i.test(pattern.source)) return input.chatOk === true;
      return false;
    },
    fillSelector: async (selector) => {
      if (/new-dm-search|searchPeople/i.test(selector)) return input.chatOk === true;
      if (/dmComposer|dm-composer|Start a message|Write a message|^Message/i.test(selector)) {
        return composerReady() && (onChat || onMessages || input.chatOk === true || buttons.Message);
      }
      return false;
    },
    clickTextContaining: async () => input.chatOk === true,
    // @ts-expect-error -- test double returns a union; runtime shape matches each call site
    evaluate: async (_fn, arg) => {
      if (typeof arg === "string") {
        return composerReady() && (onChat || onMessages);
      }
      if (arg && typeof arg === "object" && "snippet" in (arg as object)) {
        return false;
      }
      return {
        composerReady: composerReady() && (onChat || onMessages || input.chatOk === true),
        searchVisible: Boolean(input.stillOnSearch),
        stillOnRecipientSearch: Boolean(input.stillOnSearch),
      };
    },
    fillInvitationNote: async () => false,
    collectHrefs: async () => [],
    findRecipientId: async () => null,
    wait: async () => undefined,
  };
}

describe("twitter daily authorize", () => {
  it("fails closed when Daily is OFF, kill switch on, or Chrome missing", () => {
    assert.equal(
      authorizeTwitterDailyOutreach({
        policy: { ...DEFAULT_OUTREACH_ENGINE, twitterDailyOutreach: false, sendsPaused: false },
        sendProviderConfigured: true,
      }).code,
      "DAILY_OUTREACH_OFF",
    );
    assert.equal(
      authorizeTwitterDailyOutreach({
        policy: { ...DEFAULT_OUTREACH_ENGINE, twitterDailyOutreach: true, sendsPaused: true },
        sendProviderConfigured: true,
      }).code,
      "KILL_SWITCH",
    );
    assert.equal(
      authorizeTwitterDailyOutreach({
        policy: { ...DEFAULT_OUTREACH_ENGINE, twitterDailyOutreach: true, sendsPaused: false },
        sendProviderConfigured: false,
      }).code,
      "TWITTER_SEND_UNAVAILABLE",
    );
    assert.equal(
      authorizeTwitterDailyOutreach({
        policy: { ...DEFAULT_OUTREACH_ENGINE, twitterDailyOutreach: true, sendsPaused: false },
        sendProviderConfigured: true,
      }).canSend,
      true,
    );
  });

  it("builds idempotency keys", () => {
    assert.equal(twitterDailyIdempotencyKey({ leadId: "abc", day: "2026-08-28" }), "abc:X_TWITTER:dm:2026-08-28");
  });
});

describe("twitter daily run", () => {
  it("skips REJECT and DNC", () => {
    assert.equal(
      skipTwitterDailyCandidate({
        id: "1",
        leadId: "L1",
        name: "A",
        company: null,
        twitterUrl: "https://x.com/a",
        location: null,
        originalPost: "I need a developer",
        notes: null,
        source: "firecrawl",
        suppressed: true,
        leadStatus: "NEW",
        auditVerdict: "PASS",
        serviceNeedStatus: "PASS",
        opportunitySelection: null,
        roleTitle: "Founder",
        draftId: null,
        draftMessage: null,
        campaignBrief: null,
      })?.code,
      "DNC",
    );
    assert.equal(
      skipTwitterDailyCandidate({
        id: "1",
        leadId: "L1",
        name: "A",
        company: null,
        twitterUrl: "https://x.com/a",
        location: null,
        originalPost: "I need a developer",
        notes: null,
        source: "firecrawl",
        suppressed: false,
        leadStatus: "NEW",
        auditVerdict: "HOLD",
        serviceNeedStatus: null,
        opportunitySelection: null,
        roleTitle: "Founder",
        draftId: null,
        draftMessage: null,
        campaignBrief: null,
      })?.code,
      "NOT_PASS",
    );
  });

  it("allows nominated sheet buyers without Decision Maker PASS", () => {
    assert.equal(
      skipTwitterDailyCandidate({
        id: "2",
        leadId: "L2",
        name: "Clinic Owner",
        company: "Helsinki Dental Clinic",
        twitterUrl: "https://x.com/clinic_owner",
        location: "Helsinki",
        originalPost: null,
        notes: null,
        source: "google-sheets",
        suppressed: false,
        leadStatus: "NEW",
        auditVerdict: null,
        serviceNeedStatus: null,
        opportunitySelection: null,
        roleTitle: "Owner",
        draftId: null,
        draftMessage: null,
        campaignBrief: null,
      }),
      null,
    );
  });

  it("still blocks tech peers on nominated sheet sources", () => {
    assert.equal(
      skipTwitterDailyCandidate({
        id: "3",
        leadId: "L3",
        name: "CTO",
        company: "AI SaaS Labs",
        twitterUrl: "https://x.com/tech_cto",
        location: null,
        originalPost: null,
        notes: null,
        source: "csv",
        suppressed: false,
        leadStatus: "NEW",
        auditVerdict: null,
        serviceNeedStatus: null,
        opportunitySelection: null,
        roleTitle: "CTO",
        draftId: null,
        draftMessage: null,
        campaignBrief: null,
      })?.code,
      "TECH_PEER",
    );
  });

  it("sends through provider when authorized", async () => {
    const provider: TwitterSendProvider = {
      id: "test",
      configured: true,
      send: async () => ({
        ok: true,
        sent: true,
        code: "SENT",
        reason: "ok",
        provider: "test",
        externalId: "handle",
      }),
    };
    const result = await runTwitterDailyOutreach({
      policy: { ...DEFAULT_OUTREACH_ENGINE, twitterDailyOutreach: true, sendsPaused: false },
      sendProvider: provider,
      dmsSentToday: 0,
      candidates: [
        {
          id: "uuid-1",
          leadId: "L1",
          name: "Ops Founder",
          company: "Local Clinic Oy",
          twitterUrl: "https://x.com/ops_founder",
          location: null,
          originalPost: "I need a web developer",
          notes: null,
          source: "manual",
          suppressed: false,
          leadStatus: "NEW",
          auditVerdict: "PASS",
          serviceNeedStatus: "PASS",
          opportunitySelection: "PRIORITY",
          roleTitle: "Founder",
          draftId: null,
          draftMessage: null,
          campaignBrief: null,
        },
      ],
    });
    assert.equal(result.canSend, true);
    assert.equal(result.sent.length, 1);
    assert.equal(result.dmsSent, 1);
  });
});

describe("twitter inspect + executeTwitterDm", () => {
  it("detects auth and can-message states", async () => {
    const auth = await inspectTwitterPage(fakePage({ text: "Sign in to X", url: "https://x.com/i/flow/login" }));
    assert.equal(auth.state, "AUTH_REQUIRED");

    const ready = await inspectTwitterPage(
      fakePage({ text: "Ops Founder", buttons: { Message: true } }),
    );
    assert.equal(ready.state, "CAN_MESSAGE");
  });

  it("follows then messages when Message appears after Follow", async () => {
    const page = fakePage({
      text: "Ops Founder",
      buttons: { Follow: true, Message: false, Send: true },
      composerOk: true,
      confirmText: true,
    });
    const result = await executeTwitterDm(page, {
      leadId: "uuid-1",
      profileUrl: "https://x.com/ops_founder",
      kind: "dm",
      body: "Hi there — Saw you're looking for a web developer. Acme Studio can help.",
      idempotencyKey: "k",
    });
    assert.equal(result.sent, true);
    assert.equal(result.code, "SENT");
    assert.equal(result.evidence?.followed, true);
  });

  it("falls back to Chat when profile Message never appears", async () => {
    const page = fakePage({
      text: "Ops Founder",
      buttons: { Follow: false, Message: false, Send: true },
      chatOk: true,
      composerOk: true,
      confirmText: true,
    });
    const result = await executeTwitterDm(page, {
      leadId: "uuid-1",
      profileUrl: "https://x.com/ops_founder",
      kind: "dm",
      body: "Hi there — Saw you're looking for a web developer. Acme Studio can help.",
      idempotencyKey: "k",
    });
    assert.equal(result.sent, true);
    assert.equal(result.code, "SENT");
  });

  it("refuses to paste the DM body into the New message search bar", async () => {
    const page = fakePage({
      text: "Ops Founder",
      buttons: { Follow: false, Message: false },
      chatOk: true,
      composerOk: true,
      stillOnSearch: true,
    });
    const result = await executeTwitterDm(page, {
      leadId: "uuid-1",
      profileUrl: "https://x.com/ops_founder",
      kind: "dm",
      body: "Book a short meeting here: https://acme.example/go/website",
      idempotencyKey: "k",
    });
    assert.equal(result.sent, false);
    assert.equal(result.code, "CHAT_STILL_ON_SEARCH");
  });

  it("fails closed when Message and Chat both fail", async () => {
    const page = fakePage({
      text: "Private account",
      buttons: { Follow: false, Message: false },
      chatOk: false,
    });
    const result = await executeTwitterDm(page, {
      leadId: "uuid-1",
      profileUrl: "https://x.com/ops_founder",
      kind: "dm",
      body: "Hello",
      idempotencyKey: "k",
    });
    assert.equal(result.sent, false);
    assert.match(result.code, /CHAT_|DM_NOT_ALLOWED/);
  });
});

describe("twitter dm copy", () => {
  it("composes a short outreach DM", () => {
    const text = composeTwitterDm({
      name: "Alex Founder",
      originalPost: "I need a web developer to rebuild our site",
    });
    assert.match(text, /Alex/);
    assert.match(text, /Acme Studio/);
    assert.match(text, /15-min/);
  });
});

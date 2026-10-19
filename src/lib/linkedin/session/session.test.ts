import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LinkedInBrowserPage } from "@/lib/browser/linkedin-page";
import { getLinkedInConnectionStatusProvider } from "@/lib/linkedin/connection/registry";
import { UnavailableLinkedInConnectionStatusProvider } from "@/lib/linkedin/connection/unavailable-provider";
import { getLinkedInSendProvider } from "@/lib/linkedin/send/registry";
import { LINKEDIN_SEND_UNAVAILABLE, LINKEDIN_SEND_UNAVAILABLE_REASON } from "@/lib/linkedin/send/types";
import { UnavailableLinkedInSendProvider } from "@/lib/linkedin/send/unavailable";
import { executeLinkedInSend } from "@/lib/linkedin/session/actions";
import { ChromeLinkedInSendProvider } from "@/lib/linkedin/session/chrome-send";
import { ChromeLinkedInConnectionStatusProvider } from "@/lib/linkedin/session/chrome-status";
import { extractNewInbound } from "@/lib/linkedin/session/inbox";
import { inspectLinkedInProfileUi } from "@/lib/linkedin/session/inspect";
import { openLinkedInFeed, LINKEDIN_FEED_URL } from "@/lib/linkedin/session/open";
import {
  linkedInPeopleSearchQuery,
  parseAuthenticatedLinkedInProfile,
  uniquePersonProfileUrls,
} from "@/lib/linkedin/session/parse";
import { resetChromeToolForTests } from "@/lib/tools/chrome";

const PROFILE = "https://www.linkedin.com/in/sam-tester-example/";

class ScriptedLinkedInPage implements LinkedInBrowserPage {
  currentUrl = PROFILE;
  pageTitle = "Sam Tester | LinkedIn";
  text = "Software engineer 2nd";
  buttons = { connect: true, pending: false, message: false, more: false, follow: false };
  /** Connect available only after More is opened (overflow menu). */
  overflowConnect = false;
  composerOpen = false;
  sentThread = "";
  clicks: string[] = [];
  note = "";

  url() {
    return this.currentUrl;
  }
  async title() {
    return this.pageTitle;
  }
  async goto(url: string) {
    this.currentUrl = url;
    return url;
  }
  async innerText() {
    const bits = [this.text];
    if (this.buttons.connect || this.overflowConnect) bits.push("Connect");
    if (this.buttons.pending) bits.push("Pending");
    if (this.buttons.message) bits.push("Message");
    if (this.buttons.follow) bits.push("Follow");
    if (this.composerOpen) bits.push("Write a message");
    if (this.sentThread) bits.push(this.sentThread);
    return bits.join(" ");
  }
  async screenshot() {
    return null;
  }
  async hasVisibleButton(name: RegExp) {
    if (name.test("Connect") || /Invite .+ to connect/i.test(name.source)) {
      return this.buttons.connect || this.overflowConnect;
    }
    if (name.test("Pending")) return this.buttons.pending;
    if (name.test("Message")) return this.buttons.message;
    if (name.test("Follow")) return this.buttons.follow;
    if (name.test("More")) return this.buttons.more;
    if (name.test("Send")) return this.composerOpen || this.buttons.connect || this.overflowConnect;
    if (name.test("Add a note")) return this.buttons.connect || this.overflowConnect;
    if (name.test("Send without a note")) return false;
    return false;
  }
  async clickButton(name: RegExp) {
    if (name.test("More") && this.buttons.more) {
      this.clicks.push(String(name));
      this.overflowConnect = true;
      return true;
    }
    const visible = await this.hasVisibleButton(name);
    if (!visible) return false;
    this.clicks.push(String(name));
    if (name.test("Connect") || /Invite .+ to connect/i.test(name.source)) {
      this.buttons.connect = false;
      this.overflowConnect = false;
      this.buttons.pending = true;
      this.buttons.more = false;
      this.text = "Pending invitation";
      return true;
    }
    if (name.test("Message")) {
      this.composerOpen = true;
      return true;
    }
    if (name.test("Send")) {
      if (this.composerOpen && this.note) this.sentThread = this.note;
      return true;
    }
    if (name.test("Add a note")) return true;
    return true;
  }
  async fillComposer(text: string) {
    if (!this.composerOpen) return false;
    this.note = text;
    return true;
  }
  async fillInvitationNote(text: string) {
    this.note = text;
    return true;
  }
  async collectHrefs(fragment: string) {
    if (this.currentUrl.includes("/search/results/people") && fragment.includes("/in/")) {
      return ["https://www.linkedin.com/in/sam-tester-example/"];
    }
    return [];
  }
  async findRecipientId() {
    return null;
  }
  async hasScopedButton(_scope: string, name: RegExp) {
    return this.hasVisibleButton(name);
  }
  async clickScopedButton(_scope: string, name: RegExp) {
    return this.clickButton(name);
  }
  async fillPlaceholder() {
    return false;
  }
  async fillSelector() {
    return false;
  }
  async clickTextContaining() {
    return false;
  }
  async evaluate() {
    return null;
  }
  async readTopCardActions() {
    return {
      connect: this.buttons.connect,
      pending: this.buttons.pending,
      message: this.buttons.message,
      follow: this.buttons.follow,
      more: this.buttons.more,
    };
  }
  async clickTopCardAction(kind: "connect" | "more" | "message") {
    if (kind === "connect") return this.clickButton(/Connect|Invite .+ to connect/i);
    if (kind === "more") return this.clickButton(/More/i);
    return this.clickButton(/Message/i);
  }
  async clickOverflowConnect() {
    return this.clickButton(/Connect|Invite .+ to connect/i);
  }
  async clickInviteDialogSend() {
    return this.clickButton(/^Send$/i);
  }
  async wait() {}
}

describe("LinkedIn profile UI inspection", () => {
  it("never treats Message-without-1st-degree as CONNECTED", () => {
    const inspected = inspectLinkedInProfileUi({
      url: PROFILE,
      title: "Profile",
      text: "Follow Message",
      buttons: { connect: false, pending: false, message: true, follow: true },
    });
    assert.equal(inspected.state, "UNKNOWN");
    assert.notEqual(inspected.state, "CONNECTED");
  });

  it("treats Message without Connect/Pending/Follow as CONNECTED", () => {
    const inspected = inspectLinkedInProfileUi({
      url: PROFILE,
      title: "Profile",
      text: "Owner at Cafe",
      buttons: { connect: false, pending: false, message: true, follow: false },
    });
    assert.equal(inspected.state, "CONNECTED");
  });

  it("does not treat page-wide 1st alone as CONNECTED when Follow is visible", () => {
    const inspected = inspectLinkedInProfileUi({
      url: PROFILE,
      title: "Profile",
      text: "1st degree connection on another card Follow",
      buttons: { connect: false, pending: false, message: false, follow: true },
    });
    assert.equal(inspected.state, "UNKNOWN");
    assert.notEqual(inspected.state, "CONNECTED");
  });

  it("still sends Connect when the header shows Connect, even if 1st appears elsewhere on the page", () => {
    const inspected = inspectLinkedInProfileUi({
      url: PROFILE,
      title: "Profile",
      text: "2nd Mutual 1st degree connection on another card",
      buttons: { connect: true, pending: false, message: false },
    });
    assert.equal(inspected.state, "NOT_REQUESTED");
  });

  it("treats Pending as REQUESTED, not CONNECTED", () => {
    const inspected = inspectLinkedInProfileUi({
      url: PROFILE,
      title: "Profile",
      text: "Pending 2nd",
      buttons: { connect: false, pending: true, message: false },
    });
    assert.equal(inspected.state, "REQUESTED");
    assert.notEqual(inspected.state, "CONNECTED");
  });

  it("treats a login wall as AUTH_REQUIRED", () => {
    const inspected = inspectLinkedInProfileUi({
      url: "https://www.linkedin.com/authwall",
      title: "Sign Up | LinkedIn",
      text: "Agree & Join LinkedIn",
      buttons: { connect: false, pending: false, message: false },
    });
    assert.equal(inspected.state, "AUTH_REQUIRED");
  });
});

describe("LinkedIn Chrome session actions", () => {
  it("records a connection only after Pending is actually shown", async () => {
    const page = new ScriptedLinkedInPage();
    const result = await executeLinkedInSend(page, {
      leadId: "lead-1",
      profileUrl: PROFILE,
      kind: "connection",
      body: "Happy to connect.",
      idempotencyKey: "k1",
    });
    assert.equal(result.sent, true);
    assert.equal(result.code, "REQUESTED");
    assert.equal(result.evidence?.observedState, "REQUESTED");
    assert.notEqual(result.evidence?.observedState, "CONNECTED");
  });

  it("clicks Connect on sheet prospects even when the page text mentions 1st elsewhere", async () => {
    const page = new ScriptedLinkedInPage();
    page.text = "Founder 2nd Mutual 1st degree connection";
    const result = await executeLinkedInSend(page, {
      leadId: "lead-1",
      profileUrl: PROFILE,
      kind: "connection",
      body: "Happy to connect.",
      idempotencyKey: "k-sheet",
    });
    assert.equal(result.sent, true, result.reason);
    assert.equal(result.code, "REQUESTED");
    assert.ok(page.clicks.some((click) => /connect/i.test(click)));
  });

  it("opens More → Connect when Connect is not in the header even if page text mentions 1st", async () => {
    const page = new ScriptedLinkedInPage();
    page.buttons.connect = false;
    page.buttons.more = true;
    page.buttons.message = false;
    page.buttons.follow = false;
    page.text = "Restaurant owner 2nd Mutual 1st degree connection elsewhere";
    const result = await executeLinkedInSend(page, {
      leadId: "lead-more",
      profileUrl: PROFILE,
      kind: "connection",
      body: "Happy to connect.",
      idempotencyKey: "k-more",
    });
    assert.equal(result.sent, true, result.reason);
    assert.equal(result.code, "REQUESTED");
    assert.ok(page.clicks.some((click) => /more/i.test(click)));
    assert.ok(page.clicks.some((click) => /connect/i.test(click)));
  });

  it("does not fake a connection when Connect is missing", async () => {
    const page = new ScriptedLinkedInPage();
    page.buttons.connect = false;
    page.buttons.follow = true;
    page.text = "Follow 1st degree on another card";
    const result = await executeLinkedInSend(page, {
      leadId: "lead-1",
      profileUrl: PROFILE,
      kind: "connection",
      body: "Happy to connect.",
      idempotencyKey: "k1",
    });
    assert.equal(result.sent, false);
    assert.notEqual(result.code, "REQUESTED");
    assert.equal(result.code, "NO_CONNECT_OPTION");
  });

  it("skips ALREADY_CONNECTED only after More→Connect fails and Message is available", async () => {
    const page = new ScriptedLinkedInPage();
    page.buttons.connect = false;
    page.buttons.more = false;
    page.buttons.message = true;
    page.buttons.follow = false;
    page.text = "1st degree connection";
    const result = await executeLinkedInSend(page, {
      leadId: "lead-ac",
      profileUrl: PROFILE,
      kind: "connection",
      body: "Happy to connect.",
      idempotencyKey: "k-ac",
    });
    assert.equal(result.sent, false);
    assert.equal(result.code, "ALREADY_CONNECTED");
  });

  it("refuses a message until first-degree is confirmed", async () => {
    const page = new ScriptedLinkedInPage();
    const result = await executeLinkedInSend(page, {
      leadId: "lead-1",
      profileUrl: PROFILE,
      kind: "message",
      body: "Hey, great to connect.",
      idempotencyKey: "k1",
    });
    assert.equal(result.sent, false);
    assert.equal(result.code, "NOT_CONNECTED");
  });

  it("records a message only when the thread shows the sent text", async () => {
    const page = new ScriptedLinkedInPage();
    page.buttons.connect = false;
    page.buttons.message = true;
    page.text = "1st degree connection";
    const result = await executeLinkedInSend(page, {
      leadId: "lead-1",
      profileUrl: PROFILE,
      kind: "message",
      body: "Hey, great to connect. Hope you're having a good week.",
      idempotencyKey: "k1",
    });
    assert.equal(result.sent, true);
    assert.equal(result.code, "SENT");
  });

  it("fails closed on a login wall", async () => {
    const page = new ScriptedLinkedInPage();
    page.currentUrl = "https://www.linkedin.com/login";
    page.pageTitle = "Sign Up | LinkedIn";
    page.text = "Agree & Join LinkedIn";
    page.buttons.connect = false;
    const result = await executeLinkedInSend(page, {
      leadId: "lead-1",
      profileUrl: PROFILE,
      kind: "connection",
      body: "Hi",
      idempotencyKey: "k1",
    });
    assert.equal(result.sent, false);
    assert.equal(result.code, "AUTH_REQUIRED");
  });
});

describe("LinkedIn authenticated search and profile parse", () => {
  it("builds an ICP people-search query without inventing titles", () => {
    const query = linkedInPeopleSearchQuery({
      jobTitles: ["founder", "ceo"],
      industries: ["software"],
      geographies: [],
    });
    assert.match(query, /founder/i);
    assert.match(query, /software/i);
  });

  it("keeps unique person profile URLs and drops search/company links", () => {
    const urls = uniquePersonProfileUrls(
      [
        "https://www.linkedin.com/in/ada-lovelace/",
        "/in/ada-lovelace",
        "https://www.linkedin.com/company/zar-labs/",
        "https://www.linkedin.com/search/results/people/?keywords=ada",
      ],
      10,
    );
    assert.deepEqual(urls, ["https://www.linkedin.com/in/ada-lovelace"]);
  });

  it("parses an authenticated profile name and does not invent a missing company", () => {
    const parsed = parseAuthenticatedLinkedInProfile({
      url: PROFILE,
      title: "Sam Tester | LinkedIn",
      text: "Sam Tester Founder at Example Studio Message",
    });
    assert.equal(parsed.profile?.displayName, "Sam Tester");
    assert.equal(parsed.profile?.currentCompany, "Example Studio");
  });

  it("does not treat a signup wall as a profile", () => {
    const parsed = parseAuthenticatedLinkedInProfile({
      url: "https://www.linkedin.com/login",
      title: "Sign Up | LinkedIn",
      text: "Agree & Join LinkedIn",
    });
    assert.equal(parsed.profile, null);
    assert.equal(parsed.code, "AUTH_REQUIRED");
  });
});

describe("open LinkedIn feed in the Chrome session", () => {
  it("does not claim LinkedIn is open when Chrome is disconnected", async () => {
    const result = await openLinkedInFeed({
      connected: () => false,
      runOnPage: async () => {
        throw new Error("should not open a page");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.signedIn, false);
    assert.equal(result.code, "DISCONNECTED");
  });

  it("opens the feed and reports a login wall instead of inventing a signed-in session", async () => {
    const page = new ScriptedLinkedInPage();
    page.buttons = { connect: false, pending: false, message: false, follow: false, more: false };
    const result = await openLinkedInFeed({
      connected: () => true,
      runOnPage: async (fn) => {
        const original = page.goto.bind(page);
        page.goto = async (url) => {
          assert.equal(url, LINKEDIN_FEED_URL);
          await original(url);
          page.currentUrl = "https://www.linkedin.com/login/?session_redirect=https%3A%2F%2Fwww.linkedin.com%2Ffeed%2F";
          page.pageTitle = "LinkedIn Login, Sign in | LinkedIn";
          page.text = "Sign in to LinkedIn";
          return page.currentUrl;
        };
        return fn(page);
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.signedIn, false);
    assert.equal(result.state, "AUTH_REQUIRED");
    assert.match(result.message, /sign in/i);
  });

  it("reports LinkedIn open when the feed is not a login wall", async () => {
    const page = new ScriptedLinkedInPage();
    page.buttons = { connect: false, pending: false, message: false, follow: false, more: false };
    page.text = "Start a post";
    page.pageTitle = "Feed | LinkedIn";
    const result = await openLinkedInFeed({
      connected: () => true,
      runOnPage: async (fn) => {
        page.goto = async (url) => {
          assert.equal(url, LINKEDIN_FEED_URL);
          page.currentUrl = url;
          return url;
        };
        return fn(page);
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.signedIn, true);
    assert.match(result.message, /LinkedIn is open/i);
  });
});

describe("LinkedIn inbound extraction", () => {
  it("does not invent an inbound reply from UI chrome", () => {
    assert.equal(extractNewInbound("Message Send Write a message", ["Hey there"]), null);
  });

  it("returns new inbound text that is not the outbound message", () => {
    const inbound = extractNewInbound(
      "Hey, great to connect. Hope you're having a good week. Can you automate our intake?",
      ["Hey, great to connect. Hope you're having a good week."],
    );
    assert.match(inbound ?? "", /automate our intake/i);
  });
});

describe("LinkedIn send/status registry", () => {
  it("stays unavailable when Jarvis Chrome is disconnected", async () => {
    resetChromeToolForTests();
    const provider = getLinkedInSendProvider();
    assert.ok(provider instanceof UnavailableLinkedInSendProvider);
    const result = await provider.send({
      leadId: "lead-1",
      profileUrl: PROFILE,
      kind: "connection",
      body: "hello",
      idempotencyKey: "test",
    });
    assert.equal(result.sent, false);
    assert.equal(result.code, LINKEDIN_SEND_UNAVAILABLE);
    assert.equal(result.reason, LINKEDIN_SEND_UNAVAILABLE_REASON);
    assert.ok(getLinkedInConnectionStatusProvider() instanceof UnavailableLinkedInConnectionStatusProvider);
  });

  it("uses the Chrome session provider when a host is connected", async () => {
    const page = new ScriptedLinkedInPage();
    const host = {
      connected: () => true,
      runOnPage: async <T>(fn: (next: LinkedInBrowserPage) => Promise<T>) => fn(page),
    };
    const send = new ChromeLinkedInSendProvider(host);
    assert.equal(send.configured, true);
    const sent = await send.send({
      leadId: "lead-1",
      profileUrl: PROFILE,
      kind: "connection",
      body: "Happy to connect.",
      idempotencyKey: "k1",
    });
    assert.equal(sent.sent, true);
    const status = new ChromeLinkedInConnectionStatusProvider(host);
    page.buttons.connect = false;
    page.buttons.pending = true;
    const fetched = await status.fetchStatus({ profileUrl: PROFILE, normalizedUrl: PROFILE });
    assert.equal(fetched.result, "PENDING");
    assert.notEqual(fetched.result, "CONNECTED");
  });
});

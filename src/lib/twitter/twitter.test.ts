import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyTwitterDmField } from "@/lib/browser/twitter-page";
import { matchTwitterServiceIntent, buildTwitterSearchInput } from "@/lib/twitter/intent-queries";
import { mapTweetItemToLead, mapTweetItemsToLeads } from "@/lib/twitter/map-tweet";
import { inspectTwitterUrl, profileUrlFromHandle } from "@/lib/twitter/url";

describe("twitter url", () => {
  it("normalizes profile and status URLs", () => {
    assert.equal(profileUrlFromHandle("@AcmeStudio"), "https://x.com/AcmeStudio");
    assert.equal(inspectTwitterUrl("https://twitter.com/AcmeStudio").kind, "person");
    assert.equal(inspectTwitterUrl("https://x.com/AcmeStudio/status/123").kind, "status");
    assert.equal(inspectTwitterUrl("https://x.com/AcmeStudio/status/123").handle, "AcmeStudio");
  });
});

describe("twitter DM field classification", () => {
  it("marks New message search as search, not composer", () => {
    assert.equal(
      classifyTwitterDmField({ testId: "new-dm-search-input", ariaLabel: "Search people", role: "combobox" }),
      "search",
    );
    assert.equal(
      classifyTwitterDmField({ ariaLabel: "Search name or username", placeholder: "Search name or username" }),
      "search",
    );
    assert.equal(classifyTwitterDmField({ placeholder: "Search" }), "search");
  });

  it("marks real DM composers as composer", () => {
    assert.equal(
      classifyTwitterDmField({ testId: "dmComposerTextInput", role: "textbox", ariaLabel: "Start a new message" }),
      "composer",
    );
    assert.equal(classifyTwitterDmField({ testId: "dm-composer-textarea", tagName: "TEXTAREA" }), "composer");
    assert.equal(classifyTwitterDmField({ ariaLabel: "Start a message" }), "composer");
  });

  it("does not treat a generic contenteditable as a composer", () => {
    assert.equal(classifyTwitterDmField({ role: "textbox", tagName: "DIV" }), "other");
  });
});

describe("twitter intent", () => {
  it("keeps buyers seeking Acme Studio-style services", () => {
    const hit = matchTwitterServiceIntent(
      "I need a full stack developer to build a SaaS dashboard for our ops team",
    );
    assert.equal(hit.ok, true);
    assert.ok(hit.serviceHints.length > 0);
  });

  it("drops sellers, job seekers, and loose chatter", () => {
    assert.equal(matchTwitterServiceIntent("Looking for a job as a developer").ok, false);
    assert.equal(matchTwitterServiceIntent("Just shipped our new AI feature").ok, false);
    assert.equal(
      matchTwitterServiceIntent(
        "Looking for a fast custom website? I'm a Full Stack Web Developer available for freelance",
      ).ok,
      false,
    );
    assert.equal(
      matchTwitterServiceIntent("OPEN FOR COMMISSIONS Looking for a developer or designer? Hire me").ok,
      false,
    );
  });

  it("builds search input with Acme Studio queries", () => {
    const input = buildTwitterSearchInput({ maxItems: 20 });
    assert.equal(input.maxItems, 20);
    assert.ok(Array.isArray(input.searchTerms));
    assert.ok((input.searchTerms as string[]).length >= 4);
  });
});

describe("tweet mapper", () => {
  it("maps intent tweets into leads with twitterUrl", () => {
    const mapped = mapTweetItemToLead(
      {
        fullText: "I need a web developer to rebuild our company website ASAP",
        author: { userName: "ops_founder", name: "Ops Founder", location: "Dubai" },
        url: "https://x.com/ops_founder/status/99",
      },
      { source: "twitter_intent", sourceActor: "apidojo/tweet-scraper" },
    );
    assert.ok(mapped);
    assert.equal(mapped!.lead.twitterUrl, "https://x.com/ops_founder");
    assert.match(mapped!.lead.originalPost ?? "", /I need a web developer/);
    assert.equal(mapped!.intent.ok, true);
  });

  it("skips non-intent tweets", () => {
    const batch = mapTweetItemsToLeads(
      [
        { fullText: "Coffee is good", author: { userName: "a", name: "A" } },
        {
          fullText: "We're looking for an agency to build custom software for our clinic",
          author: { userName: "clinic_ceo", name: "Clinic CEO" },
        },
      ],
      { source: "twitter_intent", sourceActor: "apidojo/tweet-scraper" },
    );
    assert.equal(batch.kept, 1);
    assert.equal(batch.skipped, 1);
  });
});

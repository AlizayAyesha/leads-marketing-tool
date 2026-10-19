import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveOutreachFromAddress } from "@/lib/outreach/email-brand";
import { buildColdEmailHtml, buildColdEmailText } from "@/lib/outreach/email-html-card";
import { rfc822 } from "@/lib/outreach/email-mime";

describe("Acme Studio cold email brand", () => {
  it("defaults From to the connected Google account", () => {
    const from = resolveOutreachFromAddress({
      envFrom: "",
      envName: "",
      connectedEmail: "you@gmail.com",
    });
    assert.equal(from.email, "you@gmail.com");
    assert.match(from.header, /Your Business <you@gmail\.com>/);
  });

  it("builds a premium HTML card with escaped content and CTA", () => {
    const html = buildColdEmailHtml({
      message: "Hi Alex,\n\nWe noticed <script> on your site needs a safer rebuild.",
      company: "Northwind",
    });
    assert.match(html, /Book/);
    assert.match(html, /#22c55e/);
    assert.match(html, /Book a discovery call/);
    assert.match(html, /example\.com/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /sales@acme\.example/);
    assert.match(html, /Northwind/);
  });

  it("builds plain-text fallback with CTA", () => {
    const text = buildColdEmailText({ message: "Hello there." });
    assert.match(text, /Hello there\./);
    assert.match(text, /example\.com/);
    assert.doesNotMatch(text, /sales@acme\.example/);
  });

  it("encodes multipart alternative MIME for HTML cold sends", () => {
    const raw = Buffer.from(
      rfc822({
        to: "prospect@example.com",
        from: "Acme Studio <you@gmail.com>",
        subject: "Quick note",
        body: "Hello plain",
        html: "<p>Hello html</p>",
        replyTo: "you@gmail.com",
      }),
      "base64url",
    ).toString("utf8");
    assert.match(raw, /From: Acme Studio <you@gmail\.com>/);
    assert.match(raw, /Reply-To: you@gmail\.com/);
    assert.match(raw, /multipart\/alternative/);
    assert.match(raw, /text\/plain/);
    assert.match(raw, /text\/html/);
    assert.match(raw, /Hello plain/);
    assert.match(raw, /Hello html/);
    assert.match(raw, /unsubscribe/i);
  });
});

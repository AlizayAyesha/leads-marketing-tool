import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyInbound } from "@/lib/outreach/inbound";
import { immediateSendDecision } from "@/lib/outreach/pre-send";
import { evaluateDomainAuthentication, evaluateSenderConfiguration } from "@/lib/outreach/sender-config";
import { signUnsubscribeToken, signWebhookBody, verifyUnsubscribeToken, verifyWebhookSignature } from "@/lib/outreach/unsubscribe-token";
import { billingStatus } from "@/lib/billing/status";
import { usageAllows } from "@/lib/outreach/pre-send";

describe("bounce, unsubscribe, and the last check before send", () => {
  it("classifies mailer-daemon mail as a bounce and a human reply as a reply", () => {
    assert.equal(classifyInbound({ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification", body: "550 user unknown" }), "bounce");
    assert.equal(classifyInbound({ from: "Sam <sam@buyer.com>", subject: "Re: hello", body: "The delivery date works" }), "reply");
  });

  it("signs an https unsubscribe token and rejects a tampered one", () => {
    const env = { UNSUBSCRIBE_TOKEN_SECRET: "unsubscribe-secret-16", APP_URL: "https://jarvis.example" } as unknown as NodeJS.ProcessEnv;
    const token = signUnsubscribeToken({ email: "a@b.c", leadId: "lead", tenantId: "tenant_zar_labs", exp: Math.floor(Date.now() / 1000) + 60 }, env);
    assert.equal(verifyUnsubscribeToken(token, env)?.email, "a@b.c");
    assert.equal(verifyUnsubscribeToken(`${token}x`, env), null);
  });

  it("blocks a send when the kill switch, quota, bounce, or placeholder address is in the way", () => {
    const base = {
      sendsPaused: false,
      sendMode: "send_on_approve",
      suppressed: false,
      unsubscribed: false,
      bounced: false,
      leadStatus: "APPROVED",
      draftStatus: "APPROVED",
      alreadySent: false,
      explicitApproval: true,
      quotaRemaining: 1,
      senderBlockCode: null,
      sequenceActive: true,
    };
    assert.equal(immediateSendDecision({ ...base, sendsPaused: true }).ok, false);
    assert.equal(immediateSendDecision({ ...base, sendMode: "draft_only" }).ok, false);
    assert.equal(immediateSendDecision({ ...base, bounced: true }).ok, false);
    assert.equal(immediateSendDecision({ ...base, quotaRemaining: 0 }).ok, false);
    assert.equal(immediateSendDecision(base).ok, true);
    const sender = evaluateSenderConfiguration({
      OUTREACH_SENDER_ADDRESS: "123 Example Street, City, Country",
      NODE_ENV: "production",
      APP_URL: "http://localhost:3000",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(sender.blockCode, "SENDER_ADDRESS_REQUIRED");
  });

  it("does not claim DNS was configured, including when the mailbox domain differs", () => {
    const report = evaluateDomainAuthentication({
      fromEmail: "hello@brand.example",
      mailboxEmail: "hello@gmail.com",
      lookedUp: true,
      spfRecords: ["v=spf1 include:_spf.google.com ~all"],
      dkimRecords: [],
      dmarcRecords: ["v=DMARC1; p=none"],
    });
    assert.equal(report.summary, "mismatch");
    assert.match(report.notes.join(" "), /does not create or edit DNS/i);
  });

  it("verifies webhook signatures and keeps billing uncharged", () => {
    const body = JSON.stringify({ type: "bounce", providerEventId: "evt_1" });
    const header = signWebhookBody("hook-secret", body);
    assert.equal(verifyWebhookSignature("hook-secret", body, header), true);
    assert.equal(verifyWebhookSignature("hook-secret", body, "sha256=nope"), false);
    assert.equal(billingStatus({ STRIPE_SECRET_KEY: "sk_test_present", BILLING_PROVIDER: "stripe" } as unknown as NodeJS.ProcessEnv).chargesEnabled, false);
    assert.equal(usageAllows({ used: 10, limit: 10 }), false);
  });
});

/** Classify inbound mail without calling a provider. */

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery subsystem/i;
const BOUNCE_SUBJECT = /delivery status notification|undeliverable|delivery failure|returned mail|failure notice/i;
const BOUNCE_STATUS = /\b(5\.\d\.\d|status:\s*5\.\d\.\d|user unknown|mailbox (not found|unavailable|full)|address rejected)\b/i;

export type InboundKind = "bounce" | "reply";

export function classifyInbound(input: { from?: string | null; subject?: string | null; body?: string | null }): InboundKind {
  const from = input.from ?? "";
  const subject = input.subject ?? "";
  const body = input.body ?? "";
  if (BOUNCE_FROM.test(from) || BOUNCE_SUBJECT.test(subject)) return "bounce";
  if (BOUNCE_STATUS.test(body) && BOUNCE_FROM.test(`${from}\n${subject}`)) return "bounce";
  return "reply";
}

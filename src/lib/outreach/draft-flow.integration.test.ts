import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const databaseUrl = process.env.DATABASE_URL ?? "";
const enabled = /\/jarvis_test(\?|$)/.test(databaseUrl);

describe("draft-only outreach flow on an isolated database", { skip: enabled ? false : "Set DATABASE_URL to a database named jarvis_test" }, () => {
  let leadId = "";
  let draftId = "";

  before(async () => {
    process.env.OUTREACH_SENDER_ADDRESS = "1 Airport Road, Abu Dhabi, UAE";
    process.env.OUTREACH_FROM_NAME = "Zar Labs";
    process.env.UNSUBSCRIBE_TOKEN_SECRET = "unsubscribe-secret-16";
    process.env.APP_URL = "https://jarvis.example";
    const { prisma } = await import("@/lib/db/prisma");
    await prisma.tenant.upsert({
      where: { id: "tenant_zar_labs" },
      update: {},
      create: { id: "tenant_zar_labs", slug: "zar-labs", name: "Zar Labs" },
    });
    const lead = await prisma.lead.create({
      data: {
        leadId: `flow-${Date.now()}`,
        name: "Sam Buyer",
        company: "Northwind",
        email: `sam-${Date.now()}@buyer.test`,
        status: "READY_FOR_REVIEW",
        tenantId: "tenant_zar_labs",
      },
    });
    leadId = lead.id;
    const draft = await prisma.outreachDraft.create({
      data: {
        leadId: lead.id,
        channel: "EMAIL",
        subject: "A note",
        message: "Hello from the isolated test.",
        status: "PENDING_APPROVAL",
        tenantId: "tenant_zar_labs",
      },
    });
    draftId = draft.id;
    await prisma.setting.upsert({
      where: { key: "outreach.engine" },
      update: { value: { sendsPaused: true, sendMode: "draft_only", enabled: true, emailEnabled: true, dailySendLimit: 10 } },
      create: { key: "outreach.engine", value: { sendsPaused: true, sendMode: "draft_only", enabled: true, emailEnabled: true, dailySendLimit: 10 } },
    });
  });

  after(async () => {
    const { prisma } = await import("@/lib/db/prisma");
    if (leadId) {
      await prisma.outreachEvent.deleteMany({ where: { leadId } });
      await prisma.outreachDraft.deleteMany({ where: { leadId } });
      await prisma.outreachSequence.deleteMany({ where: { leadId } });
      await prisma.suppression.deleteMany({ where: { email: { contains: "@buyer.test" } } });
      await prisma.lead.deleteMany({ where: { id: leadId } });
    }
    await prisma.usageEntry.deleteMany({ where: { tenantId: "tenant_zar_labs", metric: "email_send" } });
    await prisma.task.deleteMany({ where: { idempotencyKey: { startsWith: "flow-test-" } } });
    await prisma.$disconnect();
  });

  it("approves a draft and refuses to send while draft-only and paused", async () => {
    const { prisma } = await import("@/lib/db/prisma");
    const { sendApprovedDraft } = await import("@/lib/outreach/send");
    await prisma.outreachDraft.update({ where: { id: draftId }, data: { status: "APPROVED", approvedAt: new Date(), approvedBy: "operator" } });
    const result = await sendApprovedDraft(draftId, { explicitApproval: true });
    assert.equal(result.sent, false);
    assert.notEqual(result.code, "SENT");
    const sent = await prisma.outreachEvent.count({ where: { draftId, type: "SENT" } });
    assert.equal(sent, 0);
  });

  it("claims a task once across two workers and dedupes the idempotency key", async () => {
    const { enqueue, claimTask } = await import("@/lib/queue/engine");
    const first = await enqueue({ type: "WRITE_OUTREACH", idempotencyKey: "flow-test-one", payload: {} });
    const second = await enqueue({ type: "WRITE_OUTREACH", idempotencyKey: "flow-test-one", payload: {} });
    assert.equal(first.id, second.id);
    const [a, b] = await Promise.all([claimTask(first.id, "worker-a"), claimTask(first.id, "worker-b")]);
    assert.equal(Number(a) + Number(b), 1);
  });

  it("stops follow-ups on a bounce and ignores the duplicate event", async () => {
    const { prisma } = await import("@/lib/db/prisma");
    const { applyDeliveryEvent } = await import("@/lib/outreach/delivery");
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    await prisma.outreachSequence.create({
      data: { leadId, channel: "EMAIL", status: "ACTIVE", tenantId: "tenant_zar_labs" },
    });
    const eventId = `bounce-${leadId}`;
    const first = await applyDeliveryEvent({
      provider: "test",
      providerEventId: eventId,
      type: "BOUNCE",
      email: lead.email,
      leadId,
      tenantId: "tenant_zar_labs",
    });
    const second = await applyDeliveryEvent({
      provider: "test",
      providerEventId: eventId,
      type: "BOUNCE",
      email: lead.email,
      leadId,
      tenantId: "tenant_zar_labs",
    });
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    assert.equal(stored.status, "DO_NOT_CONTACT");
    assert.ok(stored.bouncedAt);
    const sequence = await prisma.outreachSequence.findUniqueOrThrow({ where: { leadId_channel: { leadId, channel: "EMAIL" } } });
    assert.equal(sequence.status, "STOPPED");
    assert.equal(sequence.stopReason, "BOUNCE");
    const suppressed = await prisma.suppression.findUnique({ where: { email: lead.email!.toLowerCase() } });
    assert.equal(suppressed?.reason, "bounce");
  });

  it("reserves only one send when the daily quota is one", async () => {
    const { reserveSendUsage, releaseSendUsage } = await import("@/lib/billing/ledger");
    const first = await reserveSendUsage({ draftId: `${draftId}-a`, limit: 1, tenantId: "tenant_zar_labs" });
    const second = await reserveSendUsage({ draftId: `${draftId}-b`, limit: 1, tenantId: "tenant_zar_labs" });
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "QUOTA_EXCEEDED");
    await releaseSendUsage(`${draftId}-a`, "tenant_zar_labs");
  });
});

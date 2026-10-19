import "server-only";

import { prisma } from "@/lib/db/prisma";
import { getSetting, setSetting, writeAudit } from "@/lib/db/settings";
import { DEFAULT_OUTREACH_ENGINE } from "@/lib/outreach/policy";
import { saveOutreachEnginePolicy } from "@/lib/outreach/sequence";
import {
  DEFAULT_TEST_SESSION,
  TEST_RECIPIENT_SESSION_KEY,
  mergeTestRecipientSession,
  type TestRecipientSession,
} from "@/lib/outreach/test-flag";

export {
  DEFAULT_TEST_SESSION,
  TEST_RECIPIENT_SESSION_KEY,
  mergeTestRecipientSession,
  parseTestRecipientFlag,
  type TestRecipientSession,
} from "@/lib/outreach/test-flag";

export async function getTestRecipientSession() {
  const raw = await getSetting<unknown>(TEST_RECIPIENT_SESSION_KEY, DEFAULT_TEST_SESSION);
  return mergeTestRecipientSession(raw);
}

export async function saveTestRecipientSession(session: TestRecipientSession) {
  const next = mergeTestRecipientSession(session);
  await setSetting(TEST_RECIPIENT_SESSION_KEY, next);
  return next;
}

export async function isConfirmedTestRecipient(leadId: string) {
  const session = await getTestRecipientSession();
  if (!session.enabled || session.disabledAt || !session.confirmedAt || session.leadId !== leadId) {
    return false;
  }
  const [lead, marked] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId }, select: { testRecipient: true } }),
    prisma.lead.count({ where: { testRecipient: true } }),
  ]);
  return Boolean(lead?.testRecipient) && marked === 1;
}

export async function disableTestRecipientMode(reason = "test_complete") {
  const [{ getOutreachEnginePolicy }, session] = await Promise.all([
    import("@/lib/outreach/sequence"),
    getTestRecipientSession(),
  ]);
  const current = await getOutreachEnginePolicy();
  await prisma.lead.updateMany({ where: { testRecipient: true }, data: { testRecipient: false } });
  const disabled = await saveTestRecipientSession({
    ...DEFAULT_TEST_SESSION,
    disabledAt: new Date().toISOString(),
    publicLeadId: session.publicLeadId,
    emailGmailMessageId: session.emailGmailMessageId,
    emailSentAt: session.emailSentAt,
  });
  const restored = await saveOutreachEnginePolicy({
    ...DEFAULT_OUTREACH_ENGINE,
    bookingUrl: current.bookingUrl,
  });
  await writeAudit({
    action: "TEST_OUTREACH_DISABLED",
    entity: "setting",
    entityId: TEST_RECIPIENT_SESSION_KEY,
    payload: { reason, restored: { sendsPaused: restored.sendsPaused, sendMode: restored.sendMode } },
  });
  return disabled;
}

import "server-only";

import { prisma } from "@/lib/db/prisma";

/** Clear a crashed in-flight send claim only when no SENT event exists. */
export async function reconcileSendClaims(now = new Date()) {
  const cutoff = new Date(now.getTime() - 2 * 60 * 1000);
  const stale = await prisma.outreachDraft.findMany({
    where: { gmailMessageId: { startsWith: "pending:" }, updatedAt: { lt: cutoff } },
    select: { id: true, gmailMessageId: true },
  });
  let released = 0;
  let completed = 0;
  for (const draft of stale) {
    const sent = await prisma.outreachEvent.findFirst({ where: { draftId: draft.id, type: "SENT" } });
    if (sent) {
      await prisma.outreachDraft.updateMany({
        where: { id: draft.id, gmailMessageId: draft.gmailMessageId },
        data: { status: "SENT" },
      });
      completed += 1;
    } else {
      const result = await prisma.outreachDraft.updateMany({
        where: { id: draft.id, gmailMessageId: draft.gmailMessageId },
        data: { gmailMessageId: null },
      });
      released += result.count;
    }
  }
  return { released, completed };
}

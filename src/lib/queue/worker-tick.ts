import "server-only";

import { principalStorage } from "@/lib/auth/context";
import { workerPrincipal } from "@/lib/auth/http";
import { processQueue, reclaimExpiredLeases } from "@/lib/queue/engine";
import { tickDueSequenceSteps } from "@/lib/outreach/engine";
import { reconcileSendClaims } from "@/lib/outreach/send-claims";

export async function runWorkerTick(limit = 8) {
  return principalStorage.run(workerPrincipal(), async () => {
    const reclaimed = await reclaimExpiredLeases();
    const claims = await reconcileSendClaims();
    const results = await processQueue(limit);
    const sequences = await tickDueSequenceSteps();
    return { reclaimed, claims, processed: results.length, results, sequences, sentByThisTick: false };
  });
}

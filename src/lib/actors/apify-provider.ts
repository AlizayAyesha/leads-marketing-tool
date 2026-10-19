import "server-only";

import { ApifyService, mapApifyStatus } from "@/lib/apify/service";
import type { ActorProvider, ActorRunSnapshot, ActorStartInput } from "@/lib/actors/provider";

export class ApifyActorProvider implements ActorProvider {
  readonly id = "apify";
  private service = new ApifyService();

  async start(input: ActorStartInput): Promise<ActorRunSnapshot> {
    const run = await this.service.startRun({
      actorId: input.actorId,
      runInput: input.input,
      testMode: input.testMode,
      waitForFinishSec: input.waitForFinishSec,
    });
    return toSnapshot(run);
  }

  async status(externalRunId: string): Promise<ActorRunSnapshot> {
    return toSnapshot(await this.service.getRun(externalRunId));
  }

  async results(datasetId: string, limit: number) {
    return this.service.getDatasetItems(datasetId, limit);
  }
}

function toSnapshot(run: {
  id: string;
  status: string;
  defaultDatasetId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  statusMessage: string | null;
}): ActorRunSnapshot {
  return {
    externalRunId: run.id,
    status: mapApifyStatus(run.status),
    datasetId: run.defaultDatasetId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    message: run.statusMessage,
  };
}

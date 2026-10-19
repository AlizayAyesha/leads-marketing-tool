import "server-only";

export type ActorStartInput = {
  actorId: string;
  input: Record<string, unknown>;
  testMode?: boolean;
  waitForFinishSec?: number;
};

export type ActorRunSnapshot = {
  externalRunId: string;
  status: string;
  datasetId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
};

export interface ActorProvider {
  readonly id: string;
  start(input: ActorStartInput): Promise<ActorRunSnapshot>;
  status(externalRunId: string): Promise<ActorRunSnapshot>;
  results(datasetId: string, limit: number): Promise<unknown[]>;
}

export class ActorProviderPendingError extends Error {
  constructor(provider: string, detail: string) {
    super(`${provider}: ${detail}`);
    this.name = "ActorProviderPendingError";
  }
}

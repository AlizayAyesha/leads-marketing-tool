import "server-only";

export class IntegrationPendingError extends Error {
  constructor(adapter: string, detail: string) {
    super(`${adapter}: ${detail}`);
    this.name = "IntegrationPendingError";
  }
}

export type DataSourceResult<T> = {
  adapter: string;
  data: T;
  sourceUrls: string[];
  pending?: boolean;
  message?: string;
};

export interface DataSourceAdapter<I = unknown, O = unknown> {
  readonly id: string;
  readonly phase: 1 | 2 | 3 | 4;
  readonly configured: boolean;
  acquire(input: I): Promise<DataSourceResult<O>>;
}

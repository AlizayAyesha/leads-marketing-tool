import "server-only";

import { getEnv } from "@/lib/env";
import {
  IntegrationPendingError,
  type DataSourceAdapter,
  type DataSourceResult,
} from "@/lib/data-sources/types";

export class ApifyAdapter implements DataSourceAdapter {
  readonly id = "apify";
  readonly phase = 2 as const;
  readonly configured = Boolean(getEnv().apifyToken);

  async acquire(): Promise<DataSourceResult<never>> {
    throw new IntegrationPendingError(
      "ApifyAdapter",
      "Use the Actor Manager under Integrations. Register an Actor ID and run it through ActorProvider — this adapter is not a hard-coded scraper.",
    );
  }
}

export class FutureLinkedInAdapter implements DataSourceAdapter {
  readonly id = "linkedin";
  readonly phase = 3 as const;
  readonly configured = false;
  async acquire(): Promise<DataSourceResult<never>> {
    throw new IntegrationPendingError(
      "FutureLinkedInAdapter",
      "Use LinkedInResearchAdapter. No LinkedIn scraping, messaging, or restriction bypass is included.",
    );
  }
}

export class FutureInstagramAdapter implements DataSourceAdapter {
  readonly id = "instagram";
  readonly phase = 3 as const;
  readonly configured = false;
  async acquire(): Promise<DataSourceResult<never>> {
    throw new IntegrationPendingError(
      "FutureInstagramAdapter",
      "Use InstagramResearchAdapter. No Instagram scraping, DMs, or restriction bypass is included.",
    );
  }
}

export class FutureRedditAdapter implements DataSourceAdapter {
  readonly id = "reddit";
  readonly phase = 2 as const;
  readonly configured = false;
  async acquire(): Promise<DataSourceResult<never>> {
    throw new IntegrationPendingError(
      "FutureRedditAdapter",
      "Phase 2+ source. Not wired in this MVP.",
    );
  }
}

export class FutureDirectoryAdapter implements DataSourceAdapter {
  readonly id = "directory";
  readonly phase = 2 as const;
  readonly configured = false;
  async acquire(): Promise<DataSourceResult<never>> {
    throw new IntegrationPendingError(
      "FutureDirectoryAdapter",
      "Phase 2+ source. Not wired in this MVP.",
    );
  }
}

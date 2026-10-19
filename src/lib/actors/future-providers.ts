import "server-only";

import {
  ActorProviderPendingError,
  type ActorProvider,
  type ActorRunSnapshot,
} from "@/lib/actors/provider";

export class CustomScraperProvider implements ActorProvider {
  readonly id = "custom-scraper";
  async start(): Promise<ActorRunSnapshot> {
    throw new ActorProviderPendingError(
      "CustomScraperProvider",
      "Architecture only. Register Apify actors for acquisition.",
    );
  }
  async status(): Promise<ActorRunSnapshot> {
    throw new ActorProviderPendingError("CustomScraperProvider", "Not implemented.");
  }
  async results(): Promise<unknown[]> {
    throw new ActorProviderPendingError("CustomScraperProvider", "Not implemented.");
  }
}

export class InternalCrawlerProvider implements ActorProvider {
  readonly id = "internal-crawler";
  async start(): Promise<ActorRunSnapshot> {
    throw new ActorProviderPendingError(
      "InternalCrawlerProvider",
      "Architecture only. Public website research remains the WebsiteResearchAdapter.",
    );
  }
  async status(): Promise<ActorRunSnapshot> {
    throw new ActorProviderPendingError("InternalCrawlerProvider", "Not implemented.");
  }
  async results(): Promise<unknown[]> {
    throw new ActorProviderPendingError("InternalCrawlerProvider", "Not implemented.");
  }
}

import "server-only";

import { ApifyActorProvider } from "@/lib/actors/apify-provider";
import {
  CustomScraperProvider,
  InternalCrawlerProvider,
} from "@/lib/actors/future-providers";
import {
  ActorProviderPendingError,
  type ActorProvider,
} from "@/lib/actors/provider";

export function getActorProvider(id = "apify"): ActorProvider {
  if (id === "apify") return new ApifyActorProvider();
  if (id === "custom-scraper") return new CustomScraperProvider();
  if (id === "internal-crawler") return new InternalCrawlerProvider();
  throw new ActorProviderPendingError(id, "Unknown actor provider.");
}

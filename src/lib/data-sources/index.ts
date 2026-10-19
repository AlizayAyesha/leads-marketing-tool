import "server-only";

import { GoogleAdapter } from "@/lib/data-sources/google";
import {
  ApifyAdapter,
  FutureDirectoryAdapter,
  FutureRedditAdapter,
} from "@/lib/data-sources/stubs";
import { LinkedInResearchAdapter } from "@/lib/data-sources/linkedin-research";
import { InstagramResearchAdapter } from "@/lib/data-sources/instagram-research";
import { WebsiteResearchAdapter } from "@/lib/data-sources/website-research";
import type { DataSourceAdapter } from "@/lib/data-sources/types";

const adapters: DataSourceAdapter[] = [
  new WebsiteResearchAdapter(),
  new GoogleAdapter(),
  new ApifyAdapter(),
  new LinkedInResearchAdapter(),
  new InstagramResearchAdapter(),
  new FutureRedditAdapter(),
  new FutureDirectoryAdapter(),
];

export function listDataSources() {
  return adapters.map((adapter) => ({
    id: adapter.id,
    phase: adapter.phase,
    configured: adapter.configured,
  }));
}

export function getDataSource(id: string) {
  const adapter = adapters.find((item) => item.id === id);
  if (!adapter) throw new Error(`Unknown data source: ${id}`);
  return adapter;
}

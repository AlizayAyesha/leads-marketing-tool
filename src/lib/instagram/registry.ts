import type { InstagramResearchProvider } from "@/lib/instagram/provider";
import { UnavailableInstagramProvider } from "@/lib/instagram/unavailable-provider";

let testOverride: InstagramResearchProvider | null = null;

export function setInstagramResearchProviderForTests(provider: InstagramResearchProvider | null) {
  testOverride = provider;
}

export function getInstagramResearchProvider(): InstagramResearchProvider {
  if (testOverride) return testOverride;
  const configured = (process.env.INSTAGRAM_RESEARCH_PROVIDER ?? "").trim().toLowerCase();
  if (!configured || configured === "none" || configured === "unavailable") {
    return new UnavailableInstagramProvider();
  }
  return new UnavailableInstagramProvider();
}

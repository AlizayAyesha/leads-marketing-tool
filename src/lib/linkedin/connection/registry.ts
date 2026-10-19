import type { LinkedInConnectionStatusProvider } from "@/lib/linkedin/connection/provider";
import { UnavailableLinkedInConnectionStatusProvider } from "@/lib/linkedin/connection/unavailable-provider";
import { chromeLinkedInStatusIfReady } from "@/lib/linkedin/session/chrome-status";

let testOverride: LinkedInConnectionStatusProvider | null = null;

export function setLinkedInConnectionStatusProviderForTests(provider: LinkedInConnectionStatusProvider | null) {
  testOverride = provider;
}

export function getLinkedInConnectionStatusProvider(): LinkedInConnectionStatusProvider {
  if (testOverride) return testOverride;
  return chromeLinkedInStatusIfReady() ?? new UnavailableLinkedInConnectionStatusProvider();
}

export async function resolveLinkedInConnectionStatusProvider(): Promise<LinkedInConnectionStatusProvider> {
  return getLinkedInConnectionStatusProvider();
}

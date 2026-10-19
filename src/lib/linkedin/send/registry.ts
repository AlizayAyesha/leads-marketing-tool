import { socialAutomationEnabled } from "@/lib/features";
import type { LinkedInSendProvider } from "@/lib/linkedin/send/types";
import { UnavailableLinkedInSendProvider } from "@/lib/linkedin/send/unavailable";
import { chromeLinkedInSendIfReady } from "@/lib/linkedin/session/chrome-send";

let testOverride: LinkedInSendProvider | null = null;

export function setLinkedInSendProviderForTests(provider: LinkedInSendProvider | null) {
  testOverride = provider;
}

/**
 * LinkedIn account actions use the authenticated Jarvis Chrome session.
 * Agent-Reach is research-only. No Unipile/PDL/paid LinkedIn API required.
 */
export function getLinkedInSendProvider(): LinkedInSendProvider {
  if (testOverride) return testOverride;
  if (!socialAutomationEnabled()) return new UnavailableLinkedInSendProvider();
  return chromeLinkedInSendIfReady() ?? new UnavailableLinkedInSendProvider();
}

export async function resolveLinkedInSendProvider(): Promise<LinkedInSendProvider> {
  return getLinkedInSendProvider();
}

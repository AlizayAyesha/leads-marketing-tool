import { SOCIAL_AUTOMATION_DISABLED_REASON, socialAutomationEnabled } from "@/lib/features";
import { chromeTwitterSendIfReady } from "@/lib/twitter/session/chrome-send";
import {
  TWITTER_SEND_UNAVAILABLE,
  TWITTER_SEND_UNAVAILABLE_REASON,
  type TwitterSendProvider,
  type TwitterSendRequest,
  type TwitterSendResult,
} from "@/lib/twitter/send/types";

class UnavailableTwitterSendProvider implements TwitterSendProvider {
  readonly id = "twitter-unavailable";
  readonly configured = false;

  constructor(private readonly reasonText: string = TWITTER_SEND_UNAVAILABLE_REASON) {}

  async send(_request: TwitterSendRequest): Promise<TwitterSendResult> {
    return {
      ok: false,
      sent: false,
      code: TWITTER_SEND_UNAVAILABLE,
      reason: this.reasonText,
      provider: this.id,
      externalId: null,
    };
  }
}

export async function resolveTwitterSendProvider(): Promise<TwitterSendProvider> {
  if (!socialAutomationEnabled()) return new UnavailableTwitterSendProvider(SOCIAL_AUTOMATION_DISABLED_REASON);
  return chromeTwitterSendIfReady() ?? new UnavailableTwitterSendProvider();
}

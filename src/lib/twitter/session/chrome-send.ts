import { CHROME_TWITTER_PROVIDER_ID, executeTwitterDm } from "@/lib/twitter/session/actions";
import { chromeTwitterSessionHost, isChromeTwitterSessionReady, type TwitterSessionHost } from "@/lib/twitter/session/host";
import {
  TWITTER_SEND_UNAVAILABLE,
  TWITTER_SEND_UNAVAILABLE_REASON,
  type TwitterSendProvider,
  type TwitterSendRequest,
  type TwitterSendResult,
} from "@/lib/twitter/send/types";

export class ChromeTwitterSendProvider implements TwitterSendProvider {
  readonly id = CHROME_TWITTER_PROVIDER_ID;

  constructor(private readonly host: TwitterSessionHost = chromeTwitterSessionHost()) {}

  get configured() {
    return this.host.connected();
  }

  async send(request: TwitterSendRequest): Promise<TwitterSendResult> {
    if (!this.host.connected()) {
      return {
        ok: false,
        sent: false,
        code: TWITTER_SEND_UNAVAILABLE,
        reason: TWITTER_SEND_UNAVAILABLE_REASON,
        provider: this.id,
        externalId: null,
      };
    }
    try {
      return await this.host.runOnPage((page) => executeTwitterDm(page, request));
    } catch (error) {
      return {
        ok: false,
        sent: false,
        code: "SESSION_ERROR",
        reason: error instanceof Error ? error.message : "X Chrome session failed. Nothing was recorded as sent.",
        provider: this.id,
        externalId: null,
      };
    }
  }
}

export function chromeTwitterSendIfReady(): TwitterSendProvider | null {
  if (!isChromeTwitterSessionReady()) return null;
  return new ChromeTwitterSendProvider();
}

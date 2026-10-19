import { evidenceFromProfile } from "@/lib/linkedin/evidence";
import { LinkedInResearchError, type LinkedInResearchProvider } from "@/lib/linkedin/provider";
import type { LinkedInResearchResult } from "@/lib/linkedin/types";
import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import { CHROME_LINKEDIN_PROVIDER_ID } from "@/lib/linkedin/session/actions";
import { chromeLinkedInSessionHost, isChromeLinkedInSessionReady, type LinkedInSessionHost } from "@/lib/linkedin/session/host";
import { inspectLinkedInPage } from "@/lib/linkedin/session/inspect";
import { parseAuthenticatedLinkedInProfile } from "@/lib/linkedin/session/parse";

export class ChromeLinkedInResearchProvider implements LinkedInResearchProvider {
  readonly id = CHROME_LINKEDIN_PROVIDER_ID;
  readonly version = "1.0.0";

  constructor(private readonly host: LinkedInSessionHost = chromeLinkedInSessionHost()) {}

  get configured() {
    return this.host.connected();
  }

  async fetchProfile(input: { profileUrl: string; normalizedUrl: string }): Promise<LinkedInResearchResult> {
    if (!this.host.connected()) {
      throw new LinkedInResearchError(
        "UNAVAILABLE",
        "SESSION_DISCONNECTED",
        "Jarvis Chrome is disconnected. Connect it and sign into LinkedIn.",
      );
    }
    const inspectedUrl = inspectLinkedInUrl(input.normalizedUrl || input.profileUrl);
    if (inspectedUrl.kind !== "person" || !inspectedUrl.normalizedUrl) {
      throw new LinkedInResearchError("ERROR", "NOT_PERSON_URL", "LinkedIn research needs a person profile URL.");
    }
    return this.host.runOnPage(async (page) => {
      await page.goto(inspectedUrl.normalizedUrl!);
      const inspected = await inspectLinkedInPage(page);
      const parsed = parseAuthenticatedLinkedInProfile({
        url: page.url(),
        title: inspected.title,
        text: inspected.text,
      });
      const retrievedAt = new Date().toISOString();
      if (!parsed.profile) {
        return {
          status: parsed.code === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : "UNAVAILABLE",
          code: parsed.code,
          profile: null,
          evidence: [],
          sourceUrl: inspectedUrl.normalizedUrl,
          retrievedAt,
          adapter: this.id,
          adapterVersion: this.version,
          message: parsed.reason,
        };
      }
      return {
        status: "AVAILABLE",
        code: "OK",
        profile: parsed.profile,
        evidence: evidenceFromProfile(parsed.profile, retrievedAt),
        sourceUrl: inspectedUrl.normalizedUrl,
        retrievedAt,
        adapter: this.id,
        adapterVersion: this.version,
        message: parsed.reason,
      };
    });
  }
}

export function chromeLinkedInResearchIfReady(): LinkedInResearchProvider | null {
  if (!isChromeLinkedInSessionReady()) return null;
  return new ChromeLinkedInResearchProvider();
}

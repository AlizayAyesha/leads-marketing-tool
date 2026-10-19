import { evidenceFromProfile } from "@/lib/linkedin/evidence";
import { LinkedInResearchError, type LinkedInResearchProvider } from "@/lib/linkedin/provider";
import { emptyLinkedInProfile, type LinkedInResearchResult } from "@/lib/linkedin/types";
import { extractLinkedInPublicIdentifier } from "@/lib/linkedin/url";
import {
  AGENT_REACH_ADAPTER_ID,
  AGENT_REACH_ADAPTER_VERSION,
  inspectAgentReachLinkedInCapabilities,
} from "@/lib/agent-reach/capabilities";
import { JINA_LINKEDIN_AUTH_WALL, readLinkedInPublicPage } from "@/lib/agent-reach/jina";

export class AgentReachLinkedInProvider implements LinkedInResearchProvider {
  readonly id = AGENT_REACH_ADAPTER_ID;
  readonly version = AGENT_REACH_ADAPTER_VERSION;

  constructor(private readonly deps: { fetchImpl?: typeof fetch; configured?: boolean } = {}) {}

  get configured() {
    if (this.deps.configured !== undefined) return this.deps.configured;
    const caps = inspectAgentReachLinkedInCapabilities();
    return caps.cliInstalled || caps.mcporterInstalled;
  }

  async fetchProfile(input: { profileUrl: string; normalizedUrl: string }): Promise<LinkedInResearchResult> {
    const sourceUrl = input.normalizedUrl || input.profileUrl;
    const page = await readLinkedInPublicPage(sourceUrl, { fetchImpl: this.deps.fetchImpl });
    if (page.authWall) {
      return {
        status: "UNAVAILABLE",
        code: JINA_LINKEDIN_AUTH_WALL,
        profile: null,
        evidence: [],
        sourceUrl,
        retrievedAt: new Date().toISOString(),
        adapter: this.id,
        adapterVersion: this.version,
        message: page.error ?? "Public LinkedIn page is behind a login wall. Not evidence.",
      };
    }
    if (!page.ok) {
      throw new LinkedInResearchError("UNAVAILABLE", "AGENT_REACH_READ_FAILED", page.error || "Agent-Reach public read failed.");
    }
    const identifier = extractLinkedInPublicIdentifier(sourceUrl);
    const profile = emptyLinkedInProfile(sourceUrl);
    const nameMatch = page.text.match(/^Markdown Content:[\s\S]{0,400}?#\s+([^\n]+)/m);
    profile.displayName = nameMatch?.[1]?.trim() || identifier || null;
    if (!profile.displayName || /sign up|join linkedin/i.test(profile.displayName)) {
      return {
        status: "UNAVAILABLE",
        code: JINA_LINKEDIN_AUTH_WALL,
        profile: null,
        evidence: [],
        sourceUrl,
        retrievedAt: new Date().toISOString(),
        adapter: this.id,
        adapterVersion: this.version,
        message: "Could not extract a verifiable person name from the public page.",
      };
    }
    const retrievedAt = new Date().toISOString();
    profile.publicSignals = { backend: "jina-reader", title: page.title };
    return {
      status: "AVAILABLE",
      code: "OK",
      profile,
      evidence: evidenceFromProfile(profile, retrievedAt),
      sourceUrl,
      retrievedAt,
      adapter: this.id,
      adapterVersion: this.version,
      message: "Agent-Reach zero-config public read. Login walls are rejected.",
    };
  }
}

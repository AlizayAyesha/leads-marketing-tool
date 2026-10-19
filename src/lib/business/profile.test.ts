import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  DEFAULT_BUSINESS_PROFILE,
  normalizeBusinessProfile,
  profileDiscoveryQueries,
  setActiveBusinessProfile,
} from "@/lib/business/profile";
import { classifyBuyerRole } from "@/lib/outreach/buyer-icp";
import { wantsOurServices } from "@/lib/outreach/wants-services";
import { resolveAIConfig } from "@/lib/ai/config";
import { socialAutomationEnabled, visibleHomeSendChannels } from "@/lib/features";

afterEach(() => setActiveBusinessProfile(null));

describe("business profile", () => {
  it("normalizes comma / newline lists and booleans", () => {
    const p = normalizeBusinessProfile({ services: "seo, ads\nweb", excludeAgencies: "false" });
    assert.deepEqual(p.services, ["seo", "ads", "web"]);
    assert.equal(p.excludeAgencies, false);
    assert.equal(p.businessName, DEFAULT_BUSINESS_PROFILE.businessName);
  });

  it("uses profile target roles and exclude keywords", () => {
    setActiveBusinessProfile({ targetRoles: ["practice manager"], excludeKeywords: ["franchise"] });
    assert.equal(classifyBuyerRole("Practice Manager at Smile Dental").ok, true);
    assert.equal(classifyBuyerRole("Founder at Smile Dental").ok, false);
    assert.equal(classifyBuyerRole("Practice Manager at Smile Franchise").ok, false);
  });

  it("excludes competitors and can allow agencies when toggled off", () => {
    setActiveBusinessProfile({ competitors: ["Rival Co"] });
    assert.equal(classifyBuyerRole("Owner at Rival Co").ok, false);
    setActiveBusinessProfile({ excludeAgencies: false, targetRoles: ["agency owner"] });
    assert.equal(classifyBuyerRole("Agency owner, marketing agency").ok, true);
  });

  it("enforces profile target locations", () => {
    setActiveBusinessProfile({ targetLocations: ["Berlin"], requireDemandSignal: false });
    const base = { company: "Smile Dental", industry: "dental clinic", website: "https://x.test", email: "a@x.test", channel: "EMAIL" as const };
    assert.equal(wantsOurServices({ ...base, location: "Berlin, Germany" }).ok, true);
    assert.equal(wantsOurServices({ ...base, location: "Lagos" }).code, "WRONG_GEO");
  });

  it("builds discovery queries from industries x locations", () => {
    setActiveBusinessProfile({ targetIndustries: ["dentist"], targetLocations: ["Berlin", "Munich"] });
    assert.deepEqual(profileDiscoveryQueries(), ["dentist in Berlin", "dentist in Munich"]);
  });
});

describe("ai config", () => {
  it("defaults to openrouter and its base URL", () => {
    const c = resolveAIConfig({ OPENROUTER_API_KEY: "x" });
    assert.equal(c.provider, "openrouter");
    assert.equal(c.baseURL, "https://openrouter.ai/api/v1");
    assert.equal(c.apiKey, "x");
  });
  it("uses openai when selected and honours AI_MODEL", () => {
    const c = resolveAIConfig({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k", AI_MODEL: "gpt-4.1-mini" });
    assert.equal(c.provider, "openai");
    assert.equal(c.baseURL, undefined);
    assert.equal(c.model, "gpt-4.1-mini");
  });
  it("falls back to openai when only OPENAI_API_KEY is set", () => {
    assert.equal(resolveAIConfig({ OPENAI_API_KEY: "k" }).provider, "openai");
  });
  it("has no key (heuristic mode) when nothing is set", () => {
    assert.equal(resolveAIConfig({}).apiKey, "");
  });
});

describe("social automation flag", () => {
  it("is off by default", () => {
    assert.equal(socialAutomationEnabled({}), false);
    assert.equal(socialAutomationEnabled({ ENABLE_SOCIAL_AUTOMATION: "true" }), true);
  });

  it("shows only the email send card unless social automation is enabled", () => {
    assert.deepEqual(visibleHomeSendChannels({}), ["email"]);
    assert.deepEqual(visibleHomeSendChannels({ ENABLE_SOCIAL_AUTOMATION: "false" }), ["email"]);
    assert.deepEqual(visibleHomeSendChannels({ ENABLE_SOCIAL_AUTOMATION: "true" }), [
      "linkedin-connect",
      "linkedin-message",
      "twitter",
      "email",
    ]);
  });
});

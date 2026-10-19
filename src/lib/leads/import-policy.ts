import { compiledProfile, getBusinessProfile } from "@/lib/business/profile";
import { listingExclusion } from "@/lib/outreach/buyer-icp";
import { isGoogleMapsUrl } from "@/lib/scraping/maps-url";
import { isNonBuyerDiscoveryHost } from "@/lib/scraping/non-buyer-host";
import { safeHost } from "@/lib/utils";

export type ProfileMatch = {
  status: "KEPT";
  label: "Profile match";
  score: number;
  reason: string;
};

export type ImportDecision = {
  action: "skip-non-buyer" | "skip-excluded" | "store";
  /** Company website with Google Maps links removed. */
  website: string | null;
  websiteHost: string | null;
  /** Maps URL lifted off the website field so provenance is not lost. */
  sourceUrl: string | null;
  profile: ProfileMatch | null;
  exclusionReason: string | null;
};

export type ImportLeadFields = {
  name?: string | null;
  company?: string | null;
  website?: string | null;
  email?: string | null;
  industry?: string | null;
  location?: string | null;
  notes?: string | null;
  roleTitle?: string | null;
  sourceUrl?: string | null;
};

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function hasRealContact(website: string | null, email: string | null) {
  if (email) return true;
  if (!website) return false;
  if (isGoogleMapsUrl(website)) return false;
  if (isNonBuyerDiscoveryHost(website)) return false;
  return true;
}

function profileScore(input: {
  industrySpecific: boolean;
  locationSpecific: boolean;
  website: boolean;
  email: boolean;
}) {
  let score = 30;
  score += input.industrySpecific ? 25 : 10;
  score += input.locationSpecific ? 15 : 10;
  if (input.website) score += 20;
  if (input.email) score += 15;
  return Math.max(0, Math.min(100, score));
}

/**
 * Company-level import gate.
 * Portals, social, and search sites are dropped.
 * Google Maps URLs are listing links, not the company website.
 * Agencies and tech peers that match Business Profile exclusions are dropped
 * even when the row has no person's job title.
 * A company that fits industry and location and has a website or email is a
 * Profile match. Buying-intent qualification is a separate later step.
 */
export function decideImportLead(input: ImportLeadFields): ImportDecision {
  const email = clean(input.email);
  let website = clean(input.website);
  let sourceUrl = clean(input.sourceUrl);
  if (isGoogleMapsUrl(website)) {
    sourceUrl = sourceUrl ?? website;
    website = null;
  }

  const websiteIsPortal = Boolean(website) && isNonBuyerDiscoveryHost(website);
  const sourceIsMaps = isGoogleMapsUrl(sourceUrl);
  const sourceIsPortal = Boolean(sourceUrl) && isNonBuyerDiscoveryHost(sourceUrl) && !sourceIsMaps;
  if (websiteIsPortal || (!website && !email && sourceIsPortal)) {
    return {
      action: "skip-non-buyer",
      website,
      websiteHost: safeHost(website),
      sourceUrl,
      profile: null,
      exclusionReason: null,
    };
  }

  const identity = [input.company, input.industry, input.roleTitle, input.name].filter(Boolean).join(" ");
  const excluded = listingExclusion(identity);
  if (excluded) {
    return {
      action: "skip-excluded",
      website,
      websiteHost: safeHost(website),
      sourceUrl,
      profile: null,
      exclusionReason: excluded.reason,
    };
  }

  const profile = getBusinessProfile();
  const compiled = compiledProfile(profile);
  const industrySpecific = profile.targetIndustries.length > 0;
  const locationSpecific = profile.targetLocations.length > 0;
  const industryOk = !industrySpecific || compiled.industries.test(identity);
  const locationBlob = [input.location, input.company, input.notes].filter(Boolean).join(" ");
  const locationOk = !locationSpecific || compiled.locations.test(locationBlob);
  const contactWebsite = hasRealContact(website, null);
  const contact = hasRealContact(website, email);
  const named = Boolean(clean(input.company) || clean(input.name));

  let match: ProfileMatch | null = null;
  if (named && contact && industryOk && locationOk) {
    const score = profileScore({
      industrySpecific,
      locationSpecific,
      website: contactWebsite,
      email: Boolean(email),
    });
    const bits = [
      industrySpecific ? "industry matches your Business Profile" : "any industry is in range",
      locationSpecific ? "location matches your Business Profile" : "location is unrestricted",
      contactWebsite ? "website on file" : null,
      email ? "email on file" : null,
    ].filter(Boolean);
    match = {
      status: "KEPT",
      label: "Profile match",
      score,
      reason: `Profile match (${score}). ${bits.join("; ")}. Buying-intent qualification is separate and was not used for this keep.`,
    };
  }

  return {
    action: "store",
    website,
    websiteHost: safeHost(website),
    sourceUrl,
    profile: match,
    exclusionReason: null,
  };
}

import { safeHost } from "@/lib/utils";

/** Mass-market portals, social, and search UIs — not a company we can sell to. */
const LISTING_PORTAL_HOSTS = [
  "zameen.com",
  "olx.com",
  "olx.com.pk",
  "jaageer.com",
  "bahriatownlistings.com",
  "cozycozy.com",
  "zillow.com",
  "realtor.com",
  "redfin.com",
  "rightmove.co.uk",
  "zoopla.co.uk",
  "99acres.com",
  "magicbricks.com",
  "housing.com",
  "propertyfinder.ae",
  "bayut.com",
  "dubizzle.com",
  "craigslist.org",
] as const;

const SOCIAL_AND_SEARCH_HOSTS = [
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "linkedin.com",
  "google.com",
  "bing.com",
  "yahoo.com",
  "wikipedia.org",
] as const;

/** PE / deal directories and listicles — not a local operator we sell websites to. */
const FINANCE_DIRECTORY_HOSTS = [
  "tracxn.com",
  "altss.com",
  "crunchbase.com",
  "pitchbook.com",
  "privateequityinternational.com",
  "privatedebtinvestor.com",
  "pehub.com",
  "preqin.com",
  "dealroom.co",
  "cbinsights.com",
  "owler.com",
  "zoominfo.com",
  "apollo.io",
] as const;

function hostEqualsOrSuffix(host: string, base: string) {
  return host === base || host.endsWith(`.${base}`);
}

/**
 * True when this URL is a classifieds portal, social network, or search index —
 * not a buyer company website. Savills.com is allowed; search.savills.com is not.
 */
export function isNonBuyerDiscoveryHost(url: string | null | undefined) {
  const host = safeHost(url);
  if (!host) return false;
  if (host.startsWith("search.") || host.startsWith("maps.")) return true;
  for (const base of LISTING_PORTAL_HOSTS) {
    if (hostEqualsOrSuffix(host, base)) return true;
  }
  for (const base of SOCIAL_AND_SEARCH_HOSTS) {
    if (hostEqualsOrSuffix(host, base)) return true;
  }
  for (const base of FINANCE_DIRECTORY_HOSTS) {
    if (hostEqualsOrSuffix(host, base)) return true;
  }
  return false;
}

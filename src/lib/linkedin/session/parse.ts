import { emptyLinkedInProfile, type LinkedInProfile } from "@/lib/linkedin/types";
import { extractLinkedInPublicIdentifier, inspectLinkedInUrl, normalizeLinkedInProfileUrl } from "@/lib/linkedin/url";
import { isLinkedInAuthWall } from "@/lib/linkedin/session/inspect";
import type { IcpConfig } from "@/lib/config/business";

export function linkedInPeopleSearchQuery(icp: Pick<IcpConfig, "jobTitles" | "industries" | "geographies">) {
  const titles = icp.jobTitles.map((item) => item.trim()).filter(Boolean).slice(0, 2).join(" ");
  const industry = icp.industries[0]?.trim() ?? "";
  const geo = icp.geographies[0]?.trim() ?? "";
  return [titles || "founder CEO", industry, geo].filter(Boolean).join(" ").slice(0, 120);
}

export function linkedInPeopleSearchUrl(query: string) {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
}

export function uniquePersonProfileUrls(hrefs: string[], limit = 10) {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const href of hrefs) {
    const normalized = normalizeLinkedInProfileUrl(href);
    if (!normalized || inspectLinkedInUrl(normalized).kind !== "person") continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= limit) break;
  }
  return urls;
}

export function parseAuthenticatedLinkedInProfile(input: {
  url: string;
  title: string;
  text: string;
}): { profile: LinkedInProfile | null; code: string; reason: string } {
  if (isLinkedInAuthWall(input.url, input.title, input.text)) {
    return {
      profile: null,
      code: "AUTH_REQUIRED",
      reason: "LinkedIn login wall. Sign into LinkedIn in the connected Jarvis Chrome session.",
    };
  }
  const inspected = inspectLinkedInUrl(input.url);
  if (inspected.kind !== "person" || !inspected.normalizedUrl) {
    return { profile: null, code: "NOT_PERSON_URL", reason: "Not a LinkedIn person profile." };
  }
  const titleName = input.title.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
  const displayName =
    titleName && !/sign up|join linkedin|linkedin/i.test(titleName) ? titleName : null;
  if (!displayName) {
    return {
      profile: null,
      code: "PERSON_UNVERIFIED",
      reason: "Authenticated profile did not show a verifiable person name. Not evidence.",
    };
  }
  const profile = emptyLinkedInProfile(inspected.normalizedUrl);
  profile.displayName = displayName;
  const identifier = extractLinkedInPublicIdentifier(inspected.normalizedUrl);
  const afterName = input.text.split(displayName)[1] ?? input.text;
  const headlineMatch = afterName.match(/([A-Za-z][^\n|]{8,160}?)(?=\s+(?:Connect|Pending|Message|Follow|More)\b|$)/);
  const headline = headlineMatch?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  if (headline && !/^(Connect|Pending|Message|Follow|More)$/i.test(headline)) {
    profile.headline = headline;
    const at = headline.match(/\bat\s+(.+)$/i);
    if (at?.[1]) {
      profile.currentCompany = at[1]
        .replace(/\b(Connect|Pending|Message|Follow|More)\b.*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      profile.companyAssociation = profile.currentCompany || null;
    }
    const role = headline.split(/\bat\b/i)[0]?.trim();
    if (role && role.length < 80) profile.roleTitle = role;
  }
  profile.publicSignals = { identifier, source: "chrome-linkedin-session" };
  return { profile, code: "OK", reason: "Authenticated LinkedIn profile fields observed in the Chrome session." };
}

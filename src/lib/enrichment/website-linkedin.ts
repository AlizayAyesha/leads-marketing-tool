import { inspectLinkedInUrl, type LinkedInUrlKind } from "@/lib/linkedin/url";

export type ExtractedLinkedInUrl = {
  url: string;
  kind: LinkedInUrlKind;
};

const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;
const PLAIN_RE = /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[^\s"'<>]+/gi;

function uniquePersonOrCompany(urls: string[]): ExtractedLinkedInUrl[] {
  const seen = new Set<string>();
  const items: ExtractedLinkedInUrl[] = [];
  for (const raw of urls) {
    const inspected = inspectLinkedInUrl(raw);
    if (inspected.kind !== "person" && inspected.kind !== "company") continue;
    if (!inspected.normalizedUrl || seen.has(inspected.normalizedUrl)) continue;
    seen.add(inspected.normalizedUrl);
    items.push({ url: inspected.normalizedUrl, kind: inspected.kind });
  }
  return items;
}

export function extractLinkedInUrlsFromHtml(html: string): ExtractedLinkedInUrl[] {
  const found: string[] = [];
  for (const match of html.matchAll(HREF_RE)) {
    found.push(match[1] ?? "");
  }
  for (const match of html.matchAll(PLAIN_RE)) {
    found.push(match[0] ?? "");
  }
  return uniquePersonOrCompany(found);
}

function slugTokens(url: string) {
  const inspected = inspectLinkedInUrl(url);
  const slug = inspected.normalizedUrl?.split("/").filter(Boolean).pop() ?? "";
  return slug.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((part) => part.length >= 3);
}

function nameTokens(name?: string | null) {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((part) => part.length >= 3);
}

export function chooseWebsiteLinkedInUrl(input: {
  extracted: ExtractedLinkedInUrl[];
  leadName?: string | null;
  existingUrl?: string | null;
}): { url: string; reason: string } | null {
  const existing = inspectLinkedInUrl(input.existingUrl);
  if (existing.kind === "person") {
    return null;
  }

  const people = input.extracted.filter((item) => item.kind === "person");
  if (people.length === 1 && people[0]) {
    return { url: people[0].url, reason: "Single public person LinkedIn URL on the company website." };
  }

  const tokens = nameTokens(input.leadName);
  if (people.length > 1 && tokens.length) {
    const matched = people.filter((item) => {
      const slug = slugTokens(item.url);
      return tokens.some((token) => slug.includes(token));
    });
    if (matched.length === 1 && matched[0]) {
      return {
        url: matched[0].url,
        reason: "Public person LinkedIn URL on the website matched the stored lead name.",
      };
    }
  }

  if (existing.kind === "missing" && people.length === 0) {
    const companies = input.extracted.filter((item) => item.kind === "company");
    if (companies.length === 1 && companies[0]) {
      return { url: companies[0].url, reason: "Only a company LinkedIn page was found on the website." };
    }
  }

  return null;
}

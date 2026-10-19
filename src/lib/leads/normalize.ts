import type { RawLeadInput } from "@/types";
import { safeHost } from "@/lib/utils";

const URL_FIELDS = [
  "website",
  "linkedinUrl",
  "instagramUrl",
  "facebookUrl",
  "twitterUrl",
] as const;

export type NormalizedLead = RawLeadInput & {
  websiteHost: string | null;
  missingFields: string[];
  urlIssues: string[];
};

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseTestFlag(value?: string | boolean | null, notes?: string | null) {
  if (value === true) return true;
  const cell = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "1", "y"].includes(cell)) return true;
  return /\b(testRecipient|outreachTestMode)\s*=\s*true\b/i.test(notes ?? "");
}

function normalizeUrl(value?: string | null) {
  const raw = clean(value);
  if (!raw) return { url: null, issue: null as string | null };
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { url: null, issue: `Unsupported protocol: ${raw}` };
    }
    parsed.hash = "";
    if (!/^[a-z0-9.-]+$/i.test(parsed.hostname) || !parsed.hostname.includes(".")) {
      return { url: null, issue: `Invalid URL: ${raw}` };
    }
    return { url: parsed.toString(), issue: null };
  } catch {
    return { url: null, issue: `Invalid URL: ${raw}` };
  }
}

function normalizeEmail(value?: string | null) {
  const email = clean(value)?.toLowerCase() ?? null;
  if (!email) return { email: null, issue: null as string | null };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { email: null, issue: `Invalid email: ${email}` };
  }
  return { email, issue: null };
}

export function normalizeLead(input: RawLeadInput): NormalizedLead {
  const name = clean(input.name);
  const company = clean(input.company);
  const phone = clean(input.phone);
  const source = clean(input.source);
  const location = clean(input.location);
  const industry = clean(input.industry);
  const originalPost = clean(input.originalPost);
  const notes = clean(input.notes);
  const { email, issue: emailIssue } = normalizeEmail(input.email);

  const urlIssues: string[] = [];
  if (emailIssue) urlIssues.push(emailIssue);

  const urls: Record<(typeof URL_FIELDS)[number], string | null> = {
    website: null,
    linkedinUrl: null,
    instagramUrl: null,
    facebookUrl: null,
    twitterUrl: null,
  };

  for (const field of URL_FIELDS) {
    const result = normalizeUrl(input[field]);
    urls[field] = result.url;
    if (result.issue) urlIssues.push(result.issue);
  }

  const missingFields: string[] = [];
  if (!name) missingFields.push("name");
  if (!company) missingFields.push("company");
  if (!urls.website) missingFields.push("website");
  if (!email) missingFields.push("email");
  if (!urls.linkedinUrl) missingFields.push("linkedinUrl");

  return {
    name,
    company,
    website: urls.website,
    email,
    phone,
    linkedinUrl: urls.linkedinUrl,
    instagramUrl: urls.instagramUrl,
    facebookUrl: urls.facebookUrl,
    twitterUrl: urls.twitterUrl,
    source,
    location,
    industry,
    originalPost,
    notes,
    testRecipient: parseTestFlag(input.testRecipient, notes),
    externalRowId: clean(input.externalRowId),
    websiteHost: safeHost(urls.website),
    missingFields,
    urlIssues,
  };
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      current.push(field.trim());
      field = "";
    } else if (char === "\n") {
      current.push(field.trim());
      if (current.some((cell) => cell.length > 0)) rows.push(current);
      current = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  current.push(field.trim());
  if (current.some((cell) => cell.length > 0)) rows.push(current);
  return rows;
}

export function csvToObjects(text: string) {
  const rows = parseCsv(text);
  const headers = rows[0] ?? [];
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = row[index] ?? "";
    });
    return record;
  });
}

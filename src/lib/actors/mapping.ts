import type { RawLeadInput } from "@/types";

export const JARVIS_LEAD_FIELDS = [
  "name",
  "company",
  "website",
  "email",
  "phone",
  "linkedinUrl",
  "instagramUrl",
  "facebookUrl",
  "twitterUrl",
  "source",
  "location",
  "industry",
  "originalPost",
  "notes",
  "sourceUrl",
] as const;

export type JarvisLeadField = (typeof JARVIS_LEAD_FIELDS)[number];
export type OutputMapping = Partial<Record<JarvisLeadField, string>>;

const GUESSES: Record<JarvisLeadField, string[]> = {
  name: ["name", "fullName", "full_name", "ownerName", "contactName", "personName"],
  company: ["company", "organizationName", "organization_name", "orgName", "businessName", "business_name", "companyName", "placeName", "ownerUsername", "ownerFullName", "name", "domain"],
  website: ["website", "websiteUrl", "companyWebsite", "organization_website_url", "url", "domain", "site"],
  email: ["primaryEmail", "primary_email", "workEmail", "work_email", "leadEmail", "extractedEmails", "email", "emails", "emailAddress", "mail"],
  phone: ["primaryPhone", "primary_phone", "mobilePhone", "mobile_phone", "contactPhone", "extractedPhones", "mapsPhone", "maps_phone", "websitePhone", "phone", "phoneNumber", "phoneUnformatted", "telephone", "mobile"],
  linkedinUrl: ["linkedinUrl", "linkedin_url", "linkedin", "linkedIn"],
  instagramUrl: ["instagramUrl", "instagram_url", "instagram"],
  facebookUrl: ["facebookUrl", "facebook_url", "facebook", "fb"],
  twitterUrl: ["xUrl", "x_url", "twitterUrl", "twitter_url", "twitter", "x"],
  source: ["source"],
  location: ["address", "location", "city", "country", "locationQuery"],
  industry: ["category", "industry", "categories", "keyword"],
  originalPost: ["text", "post", "originalPost", "description"],
  notes: ["description", "about", "bio", "notes"],
  sourceUrl: ["googleMapsUrl", "google_maps_url", "mapsUrl", "sourceUrl", "profileUrl", "url", "link"],
};

function keyVariants(guess: string) {
  const lower = guess.toLowerCase();
  const snake = guess.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return snake === lower ? [lower] : [lower, snake];
}

export function guessMapping(sampleKeys: string[]): OutputMapping {
  const lower = new Map(sampleKeys.map((key) => [key.toLowerCase(), key]));
  const mapping: OutputMapping = {};
  for (const field of JARVIS_LEAD_FIELDS) {
    for (const guess of GUESSES[field]) {
      const match = keyVariants(guess).map((key) => lower.get(key)).find(Boolean);
      if (match) {
        mapping[field] = match;
        break;
      }
    }
  }
  if (mapping.company === mapping.name) delete mapping.name;
  const looksSocial = sampleKeys.some((key) =>
    ["ownerUsername", "ownerFullName", "shortCode", "caption"].includes(key),
  );
  if (looksSocial && mapping.website && mapping.website === mapping.sourceUrl) {
    delete mapping.website;
  }
  return mapping;
}

export function collectKeys(items: unknown[], limit = 5) {
  const keys = new Set<string>();
  for (const item of items.slice(0, limit)) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const key of Object.keys(item)) keys.add(key);
    }
  }
  return Array.from(keys).sort();
}

function readPath(record: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split(".");
  let current: unknown = record;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim());
    return first ? String(first).trim() : null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return asString(record.value ?? record.url ?? record.text ?? record.name);
  }
  return null;
}

function socialFieldFromUrl(
  value: string | null,
): "facebookUrl" | "instagramUrl" | "linkedinUrl" | "twitterUrl" | null {
  if (!value) return null;
  try {
    const host = new URL(/^https?:/i.test(value) ? value : `https://${value}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
    if (host === "facebook.com" || host.endsWith(".facebook.com")) return "facebookUrl";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagramUrl";
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedinUrl";
    if (host === "twitter.com" || host === "x.com" || host.endsWith(".twitter.com")) return "twitterUrl";
  } catch {
    return null;
  }
  return null;
}

export function mapActorItem(
  item: unknown,
  mapping: OutputMapping,
  extras: { source: string; sourceActor: string },
): RawLeadInput & { sourceActor?: string; sourceUrl?: string | null; rawPayload?: unknown } {
  const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const pick = (field: JarvisLeadField) => {
    const path = mapping[field];
    return path ? asString(readPath(record, path)) : null;
  };

  let website = pick("website");
  const facebookUrl = pick("facebookUrl");
  const instagramUrl = pick("instagramUrl");
  const linkedinUrl = pick("linkedinUrl");
  const twitterUrl = pick("twitterUrl");
  const socials: Record<"facebookUrl" | "instagramUrl" | "linkedinUrl" | "twitterUrl", string | null> = {
    facebookUrl,
    instagramUrl,
    linkedinUrl,
    twitterUrl,
  };
  const socialFromWebsite = socialFieldFromUrl(website);
  if (socialFromWebsite) {
    socials[socialFromWebsite] ??= website;
    website = null;
  }

  const mappedName = pick("name");
  const composedName = [asString(record.first_name ?? record.firstName), asString(record.last_name ?? record.lastName)]
    .filter(Boolean)
    .join(" ");

  return {
    name: mappedName ?? (composedName || null),
    company: pick("company"),
    website,
    email: pick("email"),
    phone: pick("phone"),
    linkedinUrl: socials.linkedinUrl,
    instagramUrl: socials.instagramUrl,
    facebookUrl: socials.facebookUrl,
    twitterUrl: socials.twitterUrl,
    source: pick("source") ?? extras.source,
    location: pick("location"),
    industry: pick("industry"),
    originalPost: pick("originalPost"),
    notes: pick("notes"),
    sourceActor: extras.sourceActor,
    sourceUrl: pick("sourceUrl"),
    rawPayload: item,
  };
}

export type InputFieldDef = {
  name: string;
  title: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  required?: boolean;
};

export function schemaToFields(schema: Record<string, unknown> | null): InputFieldDef[] {
  if (!schema || typeof schema.properties !== "object" || !schema.properties) return [];
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((item) => typeof item === "string") : [],
  );
  return Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(
    ([name, def]) => ({
      name,
      title: String(def.title ?? name),
      type: normalizeFieldType(def.type),
      description: def.description ? String(def.description) : undefined,
      required: required.has(name),
    }),
  );
}

function normalizeFieldType(type: unknown): InputFieldDef["type"] {
  const value = Array.isArray(type) ? type[0] : type;
  if (value === "integer" || value === "number") return "number";
  if (value === "boolean") return "boolean";
  if (value === "array") return "array";
  if (value === "object") return "object";
  return "string";
}

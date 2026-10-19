import type { RawLeadInput } from "@/types";
import { matchTwitterServiceIntent } from "@/lib/twitter/intent-queries";
import { inspectTwitterUrl, profileUrlFromHandle } from "@/lib/twitter/url";

function asString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function read(record: Record<string, unknown>, ...paths: string[]): unknown {
  for (const path of paths) {
    const parts = path.split(".");
    let current: unknown = record;
    for (const part of parts) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (current != null && current !== "") return current;
  }
  return undefined;
}

export type MappedTweetLead = {
  lead: RawLeadInput & { sourceActor?: string; sourceUrl?: string | null; rawPayload?: unknown };
  intent: ReturnType<typeof matchTwitterServiceIntent>;
};

/**
 * Map common Apify tweet-scraper shapes into a Jarvis lead.
 * Keeps only tweets that look like buyers of your business services.
 */
export function mapTweetItemToLead(
  item: unknown,
  extras: { source: string; sourceActor: string },
): MappedTweetLead | null {
  const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  if (record.noResults === true) return null;

  const text =
    asString(read(record, "fullText", "full_text", "text", "content", "tweetText")) ?? "";
  const intent = matchTwitterServiceIntent(text);
  if (!intent.ok) return null;

  const handle =
    asString(
      read(
        record,
        "author.userName",
        "author.username",
        "author.screen_name",
        "user.screen_name",
        "userName",
        "username",
        "screen_name",
        "fromUser",
      ),
    ) ?? null;

  const name =
    asString(
      read(record, "author.name", "author.fullName", "user.name", "name", "fromName"),
    ) ?? handle;

  const profileFromFields =
    asString(read(record, "author.url", "author.profileUrl", "user.url", "twitterUrl", "xUrl")) ??
    profileUrlFromHandle(handle);
  const profile = inspectTwitterUrl(profileFromFields);
  const twitterUrl = profile.url ?? profileUrlFromHandle(handle);
  if (!twitterUrl) return null;

  const tweetUrl =
    asString(read(record, "url", "tweetUrl", "twitterUrl", "link")) ??
    (asString(read(record, "id", "id_str", "tweetId")) && handle
      ? `https://x.com/${handle}/status/${asString(read(record, "id", "id_str", "tweetId"))}`
      : null);

  const location =
    asString(read(record, "author.location", "user.location", "location")) ?? null;

  return {
    intent,
    lead: {
      name: name || handle,
      company: null,
      website: null,
      email: null,
      phone: null,
      linkedinUrl: null,
      instagramUrl: null,
      facebookUrl: null,
      twitterUrl,
      source: extras.source,
      location,
      industry: null,
      originalPost: text,
      notes: `X intent discovery. ${intent.reason}`,
      sourceActor: extras.sourceActor,
      sourceUrl: tweetUrl ?? twitterUrl,
      rawPayload: {
        intent,
        tweet: item,
      },
    },
  };
}

export function mapTweetItemsToLeads(
  items: unknown[],
  extras: { source: string; sourceActor: string },
) {
  const leads: MappedTweetLead["lead"][] = [];
  let skipped = 0;
  for (const item of items) {
    const mapped = mapTweetItemToLead(item, extras);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    leads.push(mapped.lead);
  }
  return { leads, skipped, kept: leads.length };
}

import type { ConversationCue, ConversationStage } from "@/lib/conversation/types";

/** Public base URL of this app (booking hops live at /go/linkedin and /go/website). */
export const APP_BASE_URL = (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
const APP_HOST = APP_BASE_URL.replace(/^https?:\/\//, "");
export const LINKEDIN_MEETING_HOST = `${APP_HOST}/go/linkedin`;
export const LINKEDIN_MEETING_URL = `${APP_BASE_URL}/go/linkedin`;
export const WEBSITE_MEETING_HOST = `${APP_HOST}/go/website`;
export const WEBSITE_MEETING_URL = `${APP_BASE_URL}/go/website`;
/** Your scheduler (Calendly, Cal.com…). Set LINKEDIN_SCHEDULER_URL or Business Profile → bookingUrl. */
export const DEFAULT_LINKEDIN_SCHEDULER_URL = process.env.LINKEDIN_SCHEDULER_URL?.trim() || "";
export const MEETING_SOURCE_QUERY = "source";
export const MEETING_SOURCE_VALUE = "linkedin";
export const MEETING_WEBSITE_SOURCE_VALUE = "website";
export const MEETING_LEAD_QUERY = "lead";
export const MEETING_CONVERSATION_QUERY = "cid";

export const MEETING_ENTRY_SOURCES = ["LINKEDIN", "EMAIL", "INSTAGRAM", "WEBSITE", "OTHER"] as const;
export type MeetingEntrySource = (typeof MEETING_ENTRY_SOURCES)[number];

const OPENING_STAGES = new Set<ConversationStage>(["NONE", "CONNECTED", "GETTING_TO_KNOW"]);

const TELL_ME_MORE_RE = /\btell me more\b/i;
const EXPLICIT_INTEREST_RE =
  /\b((yeah,? )?i('d| would) be interested|i'?m interested|i am interested|yes,? i('m| am) interested|i'?d like to discuss|like to discuss (it|this)|how can we work together|how (would|do) we work together|can you show me|let'?s schedule( something)?|can we have a (call|chat|meeting))\b/i;
const CONFIRMED_INTEREST_RE =
  /\b(exactly what we need|that could help|this is relevant|sounds good)\b/i;

export function meetingEntryForChannel(channel?: string | null): {
  source: MeetingEntrySource;
  url: string | null;
} {
  if (channel === "LINKEDIN") return { source: "LINKEDIN", url: LINKEDIN_MEETING_URL };
  if (channel === "EMAIL") return { source: "EMAIL", url: null };
  if (channel === "INSTAGRAM") return { source: "INSTAGRAM", url: null };
  if (channel === "FACEBOOK" || channel === "X_TWITTER") return { source: "OTHER", url: null };
  return { source: "OTHER", url: null };
}

export function attributedLinkedInMeetingUrl(input: {
  publicLeadId?: string | null;
  conversationId?: string | null;
} = {}) {
  const url = new URL(LINKEDIN_MEETING_URL);
  url.searchParams.set(MEETING_SOURCE_QUERY, MEETING_SOURCE_VALUE);
  url.searchParams.set("utm_source", MEETING_SOURCE_VALUE);
  url.searchParams.set("utm_medium", "linkedin_dm");
  if (input.publicLeadId) url.searchParams.set(MEETING_LEAD_QUERY, input.publicLeadId);
  if (input.conversationId) url.searchParams.set(MEETING_CONVERSATION_QUERY, input.conversationId);
  return url.toString();
}

export function attributedWebsiteMeetingUrl(input: {
  publicLeadId?: string | null;
  conversationId?: string | null;
  medium?: string | null;
} = {}) {
  const url = new URL(WEBSITE_MEETING_URL);
  url.searchParams.set(MEETING_SOURCE_QUERY, MEETING_WEBSITE_SOURCE_VALUE);
  url.searchParams.set("utm_source", MEETING_WEBSITE_SOURCE_VALUE);
  url.searchParams.set("utm_medium", (input.medium ?? "reply").trim() || "reply");
  if (input.publicLeadId) url.searchParams.set(MEETING_LEAD_QUERY, input.publicLeadId);
  if (input.conversationId) url.searchParams.set(MEETING_CONVERSATION_QUERY, input.conversationId);
  return url.toString();
}

export function parseMeetingAttribution(search: URLSearchParams | string) {
  const params = typeof search === "string" ? new URL(search, APP_BASE_URL).searchParams : search;
  const raw = (params.get(MEETING_SOURCE_QUERY) || params.get("utm_source") || "").trim().toLowerCase();
  const source: MeetingEntrySource = raw === "linkedin" || raw === "" ? "LINKEDIN" : "OTHER";
  return {
    source,
    sourceSurvived: raw === MEETING_SOURCE_VALUE || params.get("utm_source")?.toLowerCase() === MEETING_SOURCE_VALUE,
    publicLeadId: params.get(MEETING_LEAD_QUERY)?.trim() || params.get("utm_campaign")?.trim() || null,
    conversationId: params.get(MEETING_CONVERSATION_QUERY)?.trim() || params.get("utm_content")?.trim() || null,
  };
}

export function forwardMeetingAttribution(destination: string, attribution: ReturnType<typeof parseMeetingAttribution>) {
  const url = new URL(destination);
  url.searchParams.set(MEETING_SOURCE_QUERY, MEETING_SOURCE_VALUE);
  url.searchParams.set("utm_source", MEETING_SOURCE_VALUE);
  url.searchParams.set("utm_medium", "linkedin_dm");
  if (attribution.publicLeadId) {
    url.searchParams.set(MEETING_LEAD_QUERY, attribution.publicLeadId);
    url.searchParams.set("utm_campaign", attribution.publicLeadId);
  }
  if (attribution.conversationId) {
    url.searchParams.set(MEETING_CONVERSATION_QUERY, attribution.conversationId);
    url.searchParams.set("utm_content", attribution.conversationId);
  }
  return url.toString();
}

export function isDuplicateMeetingStage(stage?: string | null) {
  return stage === "MEETING_BOOKED" || stage === "BOOKED" || stage === "COMPLETED";
}

export function meetingParamsFromSchedulerBody(body: unknown) {
  const params = new URLSearchParams();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { event: "ignored" as const, params };
  }
  const row = body as Record<string, unknown>;
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : row;
  const tracking =
    payload.tracking && typeof payload.tracking === "object" && !Array.isArray(payload.tracking)
      ? (payload.tracking as Record<string, unknown>)
      : {};
  const source = String(
    tracking.utm_source ?? payload.source ?? payload.utm_source ?? row.source ?? row.utm_source ?? MEETING_SOURCE_VALUE,
  );
  const lead = String(payload.lead ?? payload.leadId ?? row.lead ?? row.leadId ?? tracking.utm_campaign ?? "");
  const cid = String(payload.cid ?? payload.conversationId ?? row.cid ?? row.conversationId ?? tracking.utm_content ?? "");
  params.set(MEETING_SOURCE_QUERY, source || MEETING_SOURCE_VALUE);
  params.set("utm_source", source || MEETING_SOURCE_VALUE);
  if (lead.trim()) {
    params.set(MEETING_LEAD_QUERY, lead.trim());
    params.set("utm_campaign", lead.trim());
  }
  if (cid.trim()) {
    params.set(MEETING_CONVERSATION_QUERY, cid.trim());
    params.set("utm_content", cid.trim());
  }

  const calendly = String(row.event ?? "");
  if (calendly === "invitee.canceled") return { event: "canceled" as const, params };
  if (calendly === "invitee.created") return { event: "booked" as const, params };
  const event = String(row.event ?? "booked").toLowerCase();
  if (event === "clicked" || event === "click") return { event: "clicked" as const, params };
  if (event === "canceled" || event === "cancelled") return { event: "canceled" as const, params };
  return { event: "booked" as const, params };
}

export function isLinkedInGoPath(value: string) {
  try {
    const url = new URL(value);
    return url.pathname.replace(/\/+$/, "") === "/go/linkedin";
  } catch {
    return /\/go\/linkedin(?:\?|$)/i.test(value);
  }
}

export function bookingUrlForDraft(
  channel?: string | null,
  fallback?: string | null,
  attribution?: { publicLeadId?: string | null; conversationId?: string | null },
) {
  if (channel === "LINKEDIN") return attributedLinkedInMeetingUrl(attribution);
  if (channel === "EMAIL" || channel === "X_TWITTER" || channel === "WEBSITE") {
    return attributedWebsiteMeetingUrl({
      ...attribution,
      medium: channel === "EMAIL" ? "email_reply" : channel === "X_TWITTER" ? "x_reply" : "website",
    });
  }
  return fallback?.trim() || WEBSITE_MEETING_URL;
}

export function shouldHaltOutreachForMeeting(stage: ConversationStage) {
  return isDuplicateMeetingStage(stage);
}

export function isTellMeMore(text: string) {
  return TELL_ME_MORE_RE.test(text);
}

export function isExplicitMeetingInterest(text: string) {
  return EXPLICIT_INTEREST_RE.test(text);
}

export function linkedInCtaAllowedStage(stage: ConversationStage) {
  return (
    stage === "MEETING" ||
    stage === "MEETING_PROPOSED" ||
    stage === "LINK_SENT" ||
    stage === "BOOKING_STARTED" ||
    stage === "BOOKED" ||
    stage === "MEETING_BOOKED" ||
    stage === "COMPLETED"
  );
}

export function shouldSendMeetingLink(input: {
  from: ConversationStage;
  cue: ConversationCue;
  text: string;
}) {
  const { from, cue, text } = input;
  if (
    cue === "dnc" ||
    cue === "decline" ||
    cue === "maybe_later" ||
    cue === "casual" ||
    cue === "no_reply" ||
    cue === "problem" ||
    cue === "asked_what_you_do"
  ) {
    return false;
  }
  if (cue === "meeting" || cue === "asked_for_help" || cue === "booked" || cue === "booking_started") {
    return true;
  }
  if (isExplicitMeetingInterest(text)) return true;
  if (cue === "buying_intent") {
    return true;
  }
  if (cue === "interested") {
    if (OPENING_STAGES.has(from)) return false;
    return isTellMeMore(text) || CONFIRMED_INTEREST_RE.test(text);
  }
  return false;
}

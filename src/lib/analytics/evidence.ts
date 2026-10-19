import { analyzeConversationReply } from "@/lib/conversation/analyze";
import { LINKEDIN_MEETING_HOST, LINKEDIN_MEETING_URL } from "@/lib/conversation/booking";
import { matchConversationPain } from "@/lib/conversation/match";

export type ConversationMessage = {
  role: string;
  text: string;
  at: string | null;
  channel?: string | null;
  provider?: string | null;
  externalId?: string | null;
  profileUrl?: string | null;
};

export type EvidenceChain = {
  prospect: string | null;
  company: string | null;
  leadId: string;
  profileUrl: string | null;
  conversationHref: string;
  inboundMessage: string | null;
  need: string | null;
  jarvisResponse: string | null;
  ctaUrl: string | null;
  bookedAt: string | null;
  provider: string | null;
  externalId: string | null;
  connectionStatus: string | null;
};

const INBOUND_ROLES = new Set(["them", "prospect", "inbound", "reply", "lead"]);
const DRAFT_ROLES = new Set([
  "jarvis_draft",
  "jarvis_outbound",
  "jarvis_invite",
  "us",
  "outbound",
  "draft",
  "assistant",
]);

const PLACEHOLDER_PROBLEM =
  /not enough public information|no stated request|a public website or keyword is not a problem|insufficient public evidence|buzzwords are present without a stated problem/i;

const COMMERCIAL_NEED_RE =
  /\b(looking for|rebuild|redesign|need (a |someone|help|an? )|hire|quote|propos(e|al)|website|automat|chatbot|follow[- ]?up|leads? (are|keep)|struggling|overwhelmed)\b/i;

const QUALIFIED_CUES = new Set(["problem", "asked_for_help", "buying_intent", "meeting", "booked"]);

export function parseConversationMessages(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const text = String(row.text ?? row.body ?? row.rawText ?? "").trim();
    if (!text) return [];
    return [
      {
        role: String(row.role ?? row.from ?? "unknown"),
        text,
        at: typeof row.at === "string" ? row.at : typeof row.createdAt === "string" ? row.createdAt : null,
        channel: typeof row.channel === "string" ? row.channel : null,
        provider: typeof row.provider === "string" ? row.provider : null,
        externalId: typeof row.externalId === "string" ? row.externalId : typeof row.providerId === "string" ? row.providerId : null,
        profileUrl: typeof row.profileUrl === "string" ? row.profileUrl : null,
      },
    ];
  });
}

export function inboundMessages(messages: ConversationMessage[]) {
  return messages.filter((message) => INBOUND_ROLES.has(message.role.toLowerCase()));
}

export function latestDraftMessage(messages: ConversationMessage[]) {
  const drafts = messages.filter((message) => DRAFT_ROLES.has(message.role.toLowerCase()));
  return drafts.at(-1) ?? null;
}

const SENT_ROLES = new Set(["jarvis_outbound", "jarvis_invite", "outbound"]);

export function extractLinkedInCta(text: string | null | undefined) {
  const body = text ?? "";
  const match = body.match(/https?:\/\/\/go\/linkedin[^\s<]*/i);
  if (match?.[0]) return match[0];
  return body.includes(LINKEDIN_MEETING_HOST) ? LINKEDIN_MEETING_URL : null;
}

export function latestJarvisResponse(messages: ConversationMessage[], fallback?: string | null) {
  const sent = messages.filter((message) => SENT_ROLES.has(message.role.toLowerCase()));
  return sent.at(-1)?.text ?? latestDraftMessage(messages)?.text ?? fallback ?? null;
}

export function providerSendRole(kind: "connection" | "message") {
  return kind === "connection" ? "jarvis_invite" : "jarvis_outbound";
}

export function appendProviderSendMessage(
  existing: ConversationMessage[],
  input: {
    kind: "connection" | "message";
    body: string;
    provider: string;
    externalId?: string | null;
    profileUrl?: string | null;
    at?: string;
  },
) {
  const role = providerSendRole(input.kind);
  const text = input.body.trim();
  const duplicate = existing.some((message) => {
    if (input.externalId && message.externalId === input.externalId) return true;
    return message.role === role && message.text === text;
  });
  if (!text || duplicate) return { messages: existing, appended: false };
  return {
    messages: [
      ...existing,
      {
        role,
        text,
        at: input.at ?? new Date().toISOString(),
        channel: "LINKEDIN",
        provider: input.provider,
        externalId: input.externalId ?? null,
        profileUrl: input.profileUrl ?? null,
      },
    ],
    appended: true,
  };
}

export function buildEvidenceChain(input: {
  prospect?: string | null;
  company?: string | null;
  leadId: string;
  recordId: string;
  profileUrl?: string | null;
  inboundMessage?: string | null;
  need?: string | null;
  messages?: ConversationMessage[];
  jarvisFallback?: string | null;
  meetingEntryUrl?: string | null;
  bookedAt?: string | Date | null;
  provider?: string | null;
  externalId?: string | null;
  connectionStatus?: string | null;
}): EvidenceChain {
  const jarvisResponse = latestJarvisResponse(input.messages ?? [], input.jarvisFallback);
  const sent = (input.messages ?? []).filter((message) => SENT_ROLES.has(message.role.toLowerCase())).at(-1);
  return {
    prospect: input.prospect ?? null,
    company: input.company ?? null,
    leadId: input.leadId,
    profileUrl: input.profileUrl ?? sent?.profileUrl ?? null,
    conversationHref: `/leads/${input.recordId}`,
    inboundMessage: input.inboundMessage ?? null,
    need: input.need ?? null,
    jarvisResponse,
    ctaUrl: extractLinkedInCta(jarvisResponse) ?? input.meetingEntryUrl ?? null,
    bookedAt: input.bookedAt instanceof Date ? input.bookedAt.toISOString() : input.bookedAt ?? null,
    provider: sent?.provider ?? input.provider ?? null,
    externalId: sent?.externalId ?? input.externalId ?? null,
    connectionStatus: input.connectionStatus ?? null,
  };
}

export function isResearchPlaceholder(input: { problem?: string | null; opportunityKey?: string | null; confidence?: string | null }) {
  if ((input.opportunityKey ?? "").toLowerCase() === "unknown") return true;
  if ((input.confidence ?? "").toUpperCase() === "UNKNOWN") return true;
  if (PLACEHOLDER_PROBLEM.test(input.problem ?? "")) return true;
  return false;
}

export function commercialProspectQuote(texts: string[]) {
  for (const text of texts) {
    const body = text.trim();
    if (!body) continue;
    const analysis = analyzeConversationReply(body);
    if (QUALIFIED_CUES.has(analysis.cue) && (analysis.problem || COMMERCIAL_NEED_RE.test(body))) {
      return { quote: body, cue: analysis.cue, problem: analysis.problem };
    }
    const pain = matchConversationPain(body);
    if (pain.pain) {
      return { quote: body, cue: "problem", problem: pain.pain };
    }
    if (COMMERCIAL_NEED_RE.test(body)) {
      return { quote: body, cue: "problem", problem: body.slice(0, 180) };
    }
  }
  return null;
}

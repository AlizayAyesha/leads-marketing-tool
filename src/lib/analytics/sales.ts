import "server-only";

import type { OutreachChannel, Prisma } from "@prisma/client";

import {
  buildEvidenceChain,
  commercialProspectQuote,
  inboundMessages,
  latestDraftMessage,
  parseConversationMessages,
  type EvidenceChain,
} from "@/lib/analytics/evidence";
import { productionLeadWhere } from "@/lib/analytics/production";
import { prisma } from "@/lib/db/prisma";
import { LINKEDIN_CONNECTION_SENT_EVENT, LINKEDIN_MESSAGE_SENT_EVENT } from "@/lib/linkedin/daily/events";

export type SalesKind = "replies" | "opportunities" | "meetings" | "clients";

const BOOKED_STAGES = ["BOOKED", "MEETING_BOOKED"] as const;

function channelLabel(channel: OutreachChannel | string | null | undefined) {
  if (channel === "LINKEDIN") return "LinkedIn";
  if (channel === "EMAIL") return "Email";
  if (channel === "INSTAGRAM") return "Instagram";
  return channel || "Unknown";
}

function payloadRecord(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function linkedInTrace(input: {
  linkedinUrl?: string | null;
  leadId: string;
  connectionStatus?: string | null;
  connectionCheckedAt?: Date | null;
  events: Array<{ type: string; payload: Prisma.JsonValue; createdAt: Date }>;
}) {
  const sent =
    input.events.find((event) => event.type === LINKEDIN_MESSAGE_SENT_EVENT) ??
    input.events.find((event) => event.type === LINKEDIN_CONNECTION_SENT_EVENT);
  const payload = payloadRecord(sent?.payload);
  return {
    profileUrl: input.linkedinUrl ?? null,
    leadId: input.leadId,
    connectionStatus: input.connectionStatus ?? null,
    lastCheckedAt: input.connectionCheckedAt?.toISOString() ?? null,
    provider: typeof payload.provider === "string" ? payload.provider : null,
    externalId: typeof payload.externalId === "string" ? payload.externalId : null,
    eventType: sent?.type ?? null,
    eventAt: sent?.createdAt.toISOString() ?? null,
    body: typeof payload.body === "string" ? payload.body : null,
  };
}

function chainForLead(input: {
  name?: string | null;
  company?: string | null;
  leadId: string;
  recordId: string;
  linkedinUrl?: string | null;
  inboundMessage?: string | null;
  need?: string | null;
  messages: ReturnType<typeof parseConversationMessages>;
  jarvisFallback?: string | null;
  meetingEntryUrl?: string | null;
  bookedAt?: Date | null;
  provider?: string | null;
  externalId?: string | null;
  connectionStatus?: string | null;
}): EvidenceChain {
  return buildEvidenceChain({
    prospect: input.name,
    company: input.company,
    leadId: input.leadId,
    recordId: input.recordId,
    profileUrl: input.linkedinUrl,
    inboundMessage: input.inboundMessage,
    need: input.need,
    messages: input.messages,
    jarvisFallback: input.jarvisFallback,
    meetingEntryUrl: input.meetingEntryUrl,
    bookedAt: input.bookedAt,
    provider: input.provider,
    externalId: input.externalId,
    connectionStatus: input.connectionStatus,
  });
}

export async function getSalesEvidenceBoard() {
  const production = productionLeadWhere();
  const leads = await prisma.lead.findMany({
    where: production,
    include: {
      conversations: { orderBy: { updatedAt: "desc" } },
      replies: { orderBy: { createdAt: "desc" } },
      drafts: {
        where: { stepKind: "CONVERSATION_REPLY" },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
      linkedinConnections: { take: 1 },
      events: {
        where: { type: { in: [LINKEDIN_CONNECTION_SENT_EVENT, LINKEDIN_MESSAGE_SENT_EVENT] } },
        orderBy: { createdAt: "desc" },
        take: 8,
      },
    },
  });

  const [connectionsSent, messagesSent, researched] = await Promise.all([
    prisma.linkedInConnection.count({
      where: { lead: production, status: { in: ["REQUESTED", "CONNECTED"] } },
    }),
    prisma.outreachEvent.count({
      where: { type: LINKEDIN_MESSAGE_SENT_EVENT, lead: production },
    }),
    prisma.lead.count({
      where: { AND: [production, { status: { notIn: ["NEW"] } }] },
    }),
  ]);

  const replyRows = [];
  const opportunityRows = [];
  const meetingRows = [];
  const clientRows = [];

  for (const lead of leads) {
    const connection = lead.linkedinConnections[0];
    const trace = linkedInTrace({
      linkedinUrl: lead.linkedinUrl,
      leadId: lead.leadId,
      connectionStatus: connection?.status ?? null,
      connectionCheckedAt: connection?.lastCheckedAt ?? null,
      events: lead.events,
    });

    const conversation = lead.conversations[0];
    const conversationMessages = lead.conversations.flatMap((row) => parseConversationMessages(row.messages));
    const chainBase = {
      name: lead.name,
      company: lead.company,
      leadId: lead.leadId,
      recordId: lead.id,
      linkedinUrl: lead.linkedinUrl,
      messages: conversationMessages,
      jarvisFallback: trace.body ?? lead.drafts[0]?.message ?? null,
      meetingEntryUrl: conversation?.meetingEntryUrl ?? null,
      bookedAt: conversation?.bookedAt ?? null,
      provider: trace.provider,
      externalId: trace.externalId,
      connectionStatus: trace.connectionStatus,
    };

    const inboundFromReplies = lead.replies.map((reply) => ({
      id: reply.id,
      channel: reply.channel,
      text: reply.rawText,
      at: reply.createdAt,
    }));
    const inboundFromConversations = lead.conversations.flatMap((conversation) =>
      inboundMessages(parseConversationMessages(conversation.messages)).map((message) => ({
        id: `${conversation.id}:${message.at ?? message.text.slice(0, 12)}`,
        channel: conversation.channel,
        text: message.text,
        at: message.at ? new Date(message.at) : conversation.updatedAt,
        conversationId: conversation.id,
        stage: conversation.stage,
        draft:
          latestDraftMessage(parseConversationMessages(conversation.messages))?.text ??
          lead.drafts[0]?.message ??
          null,
      })),
    );

    const inbound = inboundFromConversations.length
      ? inboundFromConversations
      : inboundFromReplies.map((row) => ({
          ...row,
          conversationId: lead.conversations[0]?.id ?? null,
          stage: lead.conversations[0]?.stage ?? lead.status,
          draft: lead.drafts[0]?.message ?? null,
        }));

    if (inbound.length) {
      const latest = inbound[0];
      replyRows.push({
        id: latest.id,
        leadId: lead.leadId,
        recordId: lead.id,
        name: lead.name,
        company: lead.company,
        channel: channelLabel(latest.channel),
        repliedAt: latest.at.toISOString(),
        reply: latest.text,
        draftedResponse: latest.draft,
        stage: String(latest.stage),
        conversationHref: `/leads/${lead.id}`,
        evidence: ["Real conversation", "Real prospect"] as const,
        linkedIn: trace,
        chain: chainForLead({
          ...chainBase,
          inboundMessage: latest.text,
          need: commercialProspectQuote([latest.text])?.problem ?? conversation?.problem ?? null,
        }),
      });
    }

    const quote = commercialProspectQuote(inbound.map((row) => row.text));
    if (quote) {
      const source = inbound[0];
      opportunityRows.push({
        id: `${lead.id}:opportunity`,
        leadId: lead.leadId,
        recordId: lead.id,
        name: lead.name,
        company: lead.company,
        evidence: quote.quote,
        problem: quote.problem,
        source: channelLabel(source?.channel ?? lead.conversations[0]?.channel ?? "LINKEDIN"),
        conversationHref: `/leads/${lead.id}`,
        marks: ["Real conversation", "Real prospect"] as const,
        linkedIn: trace,
        chain: chainForLead({
          ...chainBase,
          inboundMessage: quote.quote,
          need: quote.problem,
        }),
      });
    }

    for (const conversation of lead.conversations) {
      if (!conversation.bookedAt) continue;
      if (!BOOKED_STAGES.includes(conversation.stage as (typeof BOOKED_STAGES)[number])) continue;
      meetingRows.push({
        id: conversation.id,
        leadId: lead.leadId,
        recordId: lead.id,
        name: lead.name,
        company: lead.company,
        bookedAt: conversation.bookedAt.toISOString(),
        calendlyUrl: conversation.meetingEntryUrl,
        source: conversation.meetingSource === "LINKEDIN" ? "linkedin" : conversation.meetingSource.toLowerCase(),
        attributionId: conversation.id,
        conversationHref: `/leads/${lead.id}`,
        status: "BOOKED",
        marks: ["Real booking", "Real prospect"] as const,
        linkedIn: trace,
        chain: chainForLead({
          ...chainBase,
          inboundMessage: commercialProspectQuote(
            inboundMessages(parseConversationMessages(conversation.messages)).map((message) => message.text),
          )?.quote ?? inbound[0]?.text ?? null,
          need: conversation.problem,
          messages: parseConversationMessages(conversation.messages),
          meetingEntryUrl: conversation.meetingEntryUrl,
          bookedAt: conversation.bookedAt,
        }),
      });
    }

    if (lead.status === "WON") {
      clientRows.push({
        id: lead.id,
        leadId: lead.leadId,
        recordId: lead.id,
        name: lead.name,
        company: lead.company,
        href: `/leads/${lead.id}`,
        marks: ["Real prospect"] as const,
        chain: chainForLead(chainBase),
      });
    }
  }

  return {
    outcomes: {
      replies: {
        count: replyRows.length,
        href: "/sales/replies",
        hint: `View ${replyRows.length} conversation${replyRows.length === 1 ? "" : "s"} →`,
      },
      opportunities: { count: opportunityRows.length, href: "/sales/opportunities", hint: "View evidence →" },
      meetings: { count: meetingRows.length, href: "/sales/meetings", hint: "View bookings →" },
      clients: { count: clientRows.length, href: "/sales/clients", hint: "View clients →" },
    },
    activity: {
      discovered: leads.length,
      researched,
      connectionsSent,
      messagesSent,
    },
    rows: {
      replies: replyRows,
      opportunities: opportunityRows,
      meetings: meetingRows,
      clients: clientRows,
    },
  };
}

export function salesKindTitle(kind: SalesKind) {
  if (kind === "replies") return "Real replies";
  if (kind === "opportunities") return "Qualified opportunities";
  if (kind === "meetings") return "Meetings booked";
  return "Clients won";
}

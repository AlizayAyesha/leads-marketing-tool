import "server-only";
import { getBusinessProfile } from "@/lib/business/profile";

import type { ConversationStage, MeetingSource } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import {
  DEFAULT_LINKEDIN_SCHEDULER_URL,
  attributedLinkedInMeetingUrl,
  forwardMeetingAttribution,
  isDuplicateMeetingStage,
  isLinkedInGoPath,
  parseMeetingAttribution,
  shouldHaltOutreachForMeeting,
} from "@/lib/conversation/booking";
import { stopSequencesForLead } from "@/lib/outreach/sequence";

const TERMINAL: ConversationStage[] = ["MEETING_BOOKED", "BOOKED", "COMPLETED", "STOPPED"];

export async function haltOutreachAfterBooking(leadId: string, reason = "MEETING_BOOKED") {
  const { stopLinkedInConnectionLifecycle } = await import("@/lib/linkedin/connection/lifecycle");
  const [sequencesStopped, linkedIn] = await Promise.all([
    stopSequencesForLead(leadId, reason),
    stopLinkedInConnectionLifecycle(leadId, reason),
  ]);
  await writeAudit({
    action: "meeting.outreach_halted",
    entity: "lead",
    entityId: leadId,
    payload: { reason, sequencesStopped, linkedInStopped: linkedIn.ok && !linkedIn.skipped },
  });
  return { sequencesStopped, linkedIn };
}

export async function resolveMeetingLead(input: {
  publicLeadId?: string | null;
  conversationId?: string | null;
}) {
  if (input.conversationId) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      include: { lead: { select: { id: true, leadId: true, status: true } } },
    });
    if (conversation) {
      return { lead: conversation.lead, conversation };
    }
  }
  if (!input.publicLeadId) return null;
  const lead = await prisma.lead.findFirst({
    where: {
      OR: [{ leadId: input.publicLeadId }, { id: input.publicLeadId }],
    },
    select: { id: true, leadId: true, status: true },
  });
  if (!lead) return null;
  const conversation = await prisma.conversation.findFirst({
    where: { leadId: lead.id, channel: "LINKEDIN" },
    orderBy: { updatedAt: "desc" },
  });
  return { lead, conversation };
}

export async function recordLinkedInCtaClick(search: URLSearchParams | string) {
  const attribution = parseMeetingAttribution(search);
  const resolved = await resolveMeetingLead({
    publicLeadId: attribution.publicLeadId,
    conversationId: attribution.conversationId,
  });
  if (!resolved) {
    await writeAudit({
      action: "meeting.cta_click_unattributed",
      entity: "meeting",
      payload: attribution,
    });
    return { ok: true as const, attributed: false, attribution, leadId: null, conversationId: null, stage: null };
  }
  const { lead, conversation } = resolved;
  if (conversation && TERMINAL.includes(conversation.stage)) {
    return {
      ok: true as const,
      attributed: true,
      attribution,
      leadId: lead.id,
      conversationId: conversation.id,
      stage: conversation.stage,
    };
  }
  const entryUrl = attributedLinkedInMeetingUrl({
    publicLeadId: lead.leadId,
    conversationId: conversation?.id,
  });
  const row = conversation
    ? await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          stage: "BOOKING_STARTED",
          meetingStage: "BOOKING_STARTED",
          meetingSource: "LINKEDIN",
          meetingEntryUrl: conversation.meetingEntryUrl || entryUrl,
          ctaClickedAt: conversation.ctaClickedAt ?? new Date(),
          signal: "cta_clicked",
          summary: "LinkedIn CTA clicked. source=linkedin survived the landing hop.",
        },
      })
    : await prisma.conversation.create({
        data: {
          leadId: lead.id,
          channel: "LINKEDIN",
          stage: "BOOKING_STARTED",
          meetingStage: "BOOKING_STARTED",
          meetingSource: "LINKEDIN",
          meetingEntryUrl: entryUrl,
          ctaClickedAt: new Date(),
          signal: "cta_clicked",
          summary: "LinkedIn CTA clicked. source=linkedin survived the landing hop.",
        },
      });
  if (lead.status !== "WON" && lead.status !== "LOST" && lead.status !== "DO_NOT_CONTACT") {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "MEETING", lastActivityAt: new Date() },
    });
  }
  await writeAudit({
    action: "meeting.cta_clicked",
    entity: "conversation",
    entityId: row.id,
    payload: { leadId: lead.leadId, source: "linkedin", stage: "BOOKING_STARTED" },
  });
  return {
    ok: true as const,
    attributed: true,
    attribution,
    leadId: lead.id,
    conversationId: row.id,
    stage: row.stage,
  };
}

export async function recordLinkedInMeetingBooked(search: URLSearchParams | string) {
  const attribution = parseMeetingAttribution(search);
  const resolved = await resolveMeetingLead({
    publicLeadId: attribution.publicLeadId,
    conversationId: attribution.conversationId,
  });
  if (!resolved) {
    await writeAudit({
      action: "meeting.booked_unattributed",
      entity: "meeting",
      payload: attribution,
    });
    return { ok: false as const, attributed: false, attribution, leadId: null, conversationId: null };
  }
  const { lead, conversation } = resolved;
  if (isDuplicateMeetingStage(conversation?.stage)) {
    const [openSequences, connection] = await Promise.all([
      prisma.outreachSequence.count({ where: { leadId: lead.id, status: { in: ["ACTIVE", "PAUSED"] } } }),
      prisma.linkedInConnection.findUnique({ where: { leadId: lead.id }, select: { stoppedAt: true } }),
    ]);
    if (openSequences > 0 || (connection && !connection.stoppedAt)) {
      await haltOutreachAfterBooking(lead.id);
    }
    return {
      ok: true as const,
      attributed: true,
      duplicate: true,
      attribution,
      leadId: lead.id,
      conversationId: conversation?.id ?? null,
      stage: conversation?.stage ?? "MEETING_BOOKED",
    };
  }
  const entryUrl = attributedLinkedInMeetingUrl({
    publicLeadId: lead.leadId,
    conversationId: conversation?.id,
  });
  const row = conversation
    ? await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          stage: "MEETING_BOOKED",
          meetingStage: "MEETING_BOOKED",
          meetingSource: "LINKEDIN" as MeetingSource,
          meetingEntryUrl: conversation.meetingEntryUrl || entryUrl,
          bookedAt: conversation.bookedAt ?? new Date(),
          signal: "meeting_booked",
          summary: "LinkedIn meeting booked. Outreach stops for this lead.",
          heat: "MEETING",
          intentScore: 5,
        },
      })
    : await prisma.conversation.create({
        data: {
          leadId: lead.id,
          channel: "LINKEDIN",
          stage: "MEETING_BOOKED",
          meetingStage: "MEETING_BOOKED",
          meetingSource: "LINKEDIN",
          meetingEntryUrl: entryUrl,
          bookedAt: new Date(),
          signal: "meeting_booked",
          summary: "LinkedIn meeting booked. Outreach stops for this lead.",
          heat: "MEETING",
          intentScore: 5,
        },
      });
  if (lead.status !== "WON" && lead.status !== "LOST" && lead.status !== "DO_NOT_CONTACT") {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "MEETING", lastActivityAt: new Date() },
    });
  }
  if (shouldHaltOutreachForMeeting("MEETING_BOOKED")) {
    await haltOutreachAfterBooking(lead.id);
  }
  const { recordLeadOutcome } = await import("@/lib/intelligence/outcome");
  await recordLeadOutcome({
    leadId: lead.id,
    channel: "LINKEDIN",
    patch: { meeting: true, sequenceStopped: true, replied: true },
  });
  await writeAudit({
    action: "meeting.booked",
    entity: "conversation",
    entityId: row.id,
    payload: { leadId: lead.leadId, source: "linkedin", stage: "MEETING_BOOKED" },
  });
  return {
    ok: true as const,
    attributed: true,
    attribution,
    leadId: lead.id,
    conversationId: row.id,
    stage: row.stage,
    duplicate: false,
  };
}

export async function linkedInCtaRedirectUrl(search: URLSearchParams, fallbackBookingUrl?: string | null) {
  const attribution = parseMeetingAttribution(search);
  const { getEnv } = await import("@/lib/env");
  const dest = getEnv().linkedinSchedulerUrl || fallbackBookingUrl?.trim() || DEFAULT_LINKEDIN_SCHEDULER_URL;
  if (!dest || isLinkedInGoPath(dest)) return null;
  try {
    return forwardMeetingAttribution(dest, attribution);
  } catch {
    return null;
  }
}

export async function recordWebsiteCtaClick(search: URLSearchParams | string) {
  const params = typeof search === "string" ? new URL(search, "http://localhost").searchParams : search;
  const publicLeadId = params.get("lead")?.trim() || params.get("utm_campaign")?.trim() || null;
  const conversationId = params.get("cid")?.trim() || params.get("utm_content")?.trim() || null;
  const resolved = await resolveMeetingLead({ publicLeadId, conversationId });
  await writeAudit({
    action: "meeting.website_cta_clicked",
    entity: "meeting",
    payload: {
      publicLeadId,
      conversationId,
      attributed: Boolean(resolved),
      source: "website",
    },
  });
  if (!resolved) {
    return { ok: true as const, attributed: false, leadId: null, conversationId: null };
  }
  const { lead, conversation } = resolved;
  if (lead.status !== "WON" && lead.status !== "LOST" && lead.status !== "DO_NOT_CONTACT") {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "MEETING", lastActivityAt: new Date() },
    });
  }
  if (conversation) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        stage: conversation.stage === "MEETING_BOOKED" ? conversation.stage : "BOOKING_STARTED",
        meetingStage: "BOOKING_STARTED",
        meetingSource: "OTHER",
        ctaClickedAt: conversation.ctaClickedAt ?? new Date(),
        signal: "cta_clicked",
        summary: "Website booking CTA clicked (/go/website).",
      },
    });
  }
  return {
    ok: true as const,
    attributed: true,
    leadId: lead.id,
    conversationId: conversation?.id ?? null,
  };
}

export async function websiteCtaRedirectUrl(search: URLSearchParams, fallbackBookingUrl?: string | null) {
  const { getEnv } = await import("@/lib/env");
  const { WEBSITE_MEETING_URL, DEFAULT_LINKEDIN_SCHEDULER_URL, isLinkedInGoPath } = await import(
    "@/lib/conversation/booking"
  );
  const dest =
    getEnv().linkedinSchedulerUrl ||
    fallbackBookingUrl?.trim() ||
    DEFAULT_LINKEDIN_SCHEDULER_URL ||
    (getBusinessProfile().website || "http://localhost:3000");
  if (!dest || isLinkedInGoPath(dest) || dest.includes("/go/website")) {
    return (getBusinessProfile().website || "http://localhost:3000");
  }
  try {
    const url = new URL(dest);
    const lead = search.get("lead");
    const cid = search.get("cid");
    url.searchParams.set("source", "website");
    url.searchParams.set("utm_source", "website");
    if (lead) url.searchParams.set("lead", lead);
    if (cid) url.searchParams.set("cid", cid);
    return url.toString();
  } catch {
    return WEBSITE_MEETING_URL;
  }
}

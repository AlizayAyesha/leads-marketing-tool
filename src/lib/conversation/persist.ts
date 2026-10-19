import "server-only";

import type { OutreachChannel, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/db/settings";
import { analyzeConversationReply, shouldStopLinkedInOnReply } from "@/lib/conversation/analyze";
import { decideConversationTransition, openingConversationStage } from "@/lib/conversation/machine";
import { assertNoBrochure, assertNoConsulting, assertNoPrematureBookingLink, assertNoPrematurePitch, draftConversationMessage, conversationObservation } from "@/lib/conversation/draft";
import { assertCommercialDraft } from "@/lib/conversation/qa";
import { attributedLinkedInMeetingUrl, bookingUrlForDraft, meetingEntryForChannel, shouldHaltOutreachForMeeting } from "@/lib/conversation/booking";
import { raiseLeadTemperature } from "@/lib/conversation/heat";
import {
  CONVERSATION_REPLY_STEP,
  firstNameFrom,
  normalizeConversationStage,
  type ConversationContext,
  type ConversationHeat,
  type ConversationStage,
} from "@/lib/conversation/types";

export function contextFromLead(input: {
  name?: string | null;
  company?: string | null;
  headline?: string | null;
  about?: string | null;
  roleTitle?: string | null;
  websiteTitle?: string | null;
}): ConversationContext {
  return {
    firstName: firstNameFrom(input.name),
    company: input.company ?? null,
    headline: input.headline ?? null,
    about: input.about ?? null,
    roleTitle: input.roleTitle ?? null,
    websiteTitle: input.websiteTitle ?? null,
    observation: conversationObservation({
      firstName: firstNameFrom(input.name),
      company: input.company ?? null,
      headline: input.headline ?? null,
      about: input.about ?? null,
      roleTitle: input.roleTitle ?? null,
      websiteTitle: input.websiteTitle ?? null,
      observation: null,
    }),
  };
}

async function loadConversation(leadId: string, channel: OutreachChannel) {
  return prisma.conversation.findFirst({
    where: { leadId, channel },
    orderBy: { updatedAt: "desc" },
  });
}

export async function ensureOpeningConversation(input: {
  leadId: string;
  channel?: OutreachChannel;
  ctx: ConversationContext;
}) {
  const channel = input.channel ?? "LINKEDIN";
  const decision = openingConversationStage();
  const drafted = draftConversationMessage({ stage: "GETTING_TO_KNOW", ctx: { ...input.ctx, channel } });
  assertNoPrematurePitch("GETTING_TO_KNOW", drafted.message);
  assertNoConsulting(drafted.message);
  assertNoBrochure(drafted.message);
  assertNoPrematureBookingLink("GETTING_TO_KNOW", drafted.message);
  const existing = await loadConversation(input.leadId, channel);
  if (existing && existing.stage !== "NONE" && existing.stage !== "CONNECTED") {
    return { conversation: existing, draft: drafted, decision };
  }
  const data = {
    stage: "GETTING_TO_KNOW" as ConversationStage,
    summary: decision.reason,
    signal: "opening",
    problem: null as string | null,
    pitchAllowed: false,
    intentScore: 0,
    heat: "COLD" as ConversationHeat,
    analysis: {
      cue: "no_reply",
      doNotPitch: true,
      observation: input.ctx.observation,
      intentScore: 0,
      heat: "COLD",
    } as Prisma.InputJsonValue,
  };
  const row = existing
    ? await prisma.conversation.update({ where: { id: existing.id }, data })
    : await prisma.conversation.create({
        data: { leadId: input.leadId, channel, ...data },
      });
  await writeAudit({
    action: "conversation.opening_drafted",
    entity: "conversation",
    entityId: row.id,
    payload: { stage: row.stage, pitchAllowed: false },
  });
  return { conversation: row, draft: drafted, decision };
}

export async function applyConversationReply(input: {
  leadId: string;
  text: string;
  channel?: OutreachChannel;
  connected: boolean;
  ctx: ConversationContext;
}) {
  const channel = input.channel ?? "LINKEDIN";
  const { getOutreachEnginePolicy } = await import("@/lib/outreach/sequence");
  const policy = await getOutreachEnginePolicy();
  const entry = meetingEntryForChannel(channel);
  const leadRow = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { leadId: true, temperature: true, status: true },
  });
  const analysis = analyzeConversationReply(input.text);
  const existing = await loadConversation(input.leadId, channel);
  const from =
    normalizeConversationStage(existing?.stage) ?? (input.connected ? "CONNECTED" : "NONE");
  const decision = decideConversationTransition({
    from,
    analysis,
    connected: input.connected,
    hasBookingUrl: channel === "LINKEDIN" || Boolean(policy.bookingUrl),
    channel,
  });
  if (decision.code === "NOT_CONNECTED") {
    return {
      analysis,
      decision,
      draft: { message: "", goal: decision.reason, doNotSay: ["Do not send."] },
      draftId: null,
      conversationId: existing?.id ?? null,
      stopLinkedIn: false,
    };
  }

  const conversation =
    existing ??
    (await prisma.conversation.create({
      data: { leadId: input.leadId, channel, stage: from === "NONE" ? "CONNECTED" : from },
    }));
  const sendingLink = decision.to === "LINK_SENT";
  const attributed =
    channel === "LINKEDIN"
      ? attributedLinkedInMeetingUrl({ publicLeadId: leadRow?.leadId, conversationId: conversation.id })
      : bookingUrlForDraft(channel, input.ctx.bookingUrl ?? policy.bookingUrl);
  const ctx = {
    ...input.ctx,
    channel,
    publicLeadId: leadRow?.leadId ?? null,
    conversationId: conversation.id,
    bookingUrl: sendingLink ? attributed : input.ctx.bookingUrl ?? policy.bookingUrl,
  };

  const alreadyBooked = from === "MEETING_BOOKED" || from === "BOOKED" || from === "COMPLETED";
  const drafted =
    decision.to === "STOPPED" || decision.wait || alreadyBooked
      ? { message: "", goal: alreadyBooked ? "Meeting booked. Stop outreach." : decision.reason, doNotSay: ["Do not send."] }
      : draftConversationMessage({
          stage: decision.to,
          fromStage: from,
          ctx,
          replyExcerpt: input.text,
          problem: analysis.problem,
          match: analysis.match,
          cue: analysis.cue,
        });
  if (drafted.message) {
    assertNoPrematurePitch(decision.to, drafted.message);
    assertNoConsulting(drafted.message);
    assertNoBrochure(drafted.message);
    assertNoPrematureBookingLink(decision.to, drafted.message);
    assertCommercialDraft({ message: drafted.message, stage: decision.to, cue: analysis.cue });
  }

  const messages = Array.isArray(conversation.messages) ? [...(conversation.messages as object[])] : [];
  messages.push({ role: "them", text: input.text, at: new Date().toISOString() });
  if (drafted.message) messages.push({ role: "jarvis_draft", text: drafted.message, at: new Date().toISOString() });

  const booked = shouldHaltOutreachForMeeting(decision.to);
  const data = {
    stage: decision.to,
    summary: decision.reason,
    signal: analysis.signal,
    problem: analysis.problem,
    pitchAllowed: decision.pitchAllowed,
    intentScore: analysis.intentScore,
    heat: decision.heat,
    whyNow: analysis.whyNow as unknown as Prisma.InputJsonValue,
    meetingStage: ["MEETING_PROPOSED", "LINK_SENT", "BOOKING_STARTED", "BOOKED", "MEETING_BOOKED", "COMPLETED"].includes(decision.to)
      ? decision.to
      : conversation.meetingStage ?? null,
    meetingSource: sendingLink ? entry.source : conversation.meetingSource ?? "UNKNOWN",
    meetingEntryUrl: sendingLink ? ctx.bookingUrl || attributed : conversation.meetingEntryUrl ?? null,
    linkSentAt: sendingLink ? conversation.linkSentAt ?? new Date() : conversation.linkSentAt ?? null,
    bookedAt: booked ? conversation.bookedAt ?? new Date() : conversation.bookedAt ?? null,
    analysis: analysis as unknown as Prisma.InputJsonValue,
    messages: messages as Prisma.InputJsonValue,
    stoppedAt: decision.stopRelationship ? new Date() : conversation.stoppedAt ?? null,
    stopReason: decision.stopRelationship ? analysis.summary : conversation.stopReason ?? null,
  };
  const row = await prisma.conversation.update({ where: { id: conversation.id }, data });

  let draftId: string | null = null;
  const enqueueDraft = drafted.message && !booked;
  if (enqueueDraft) {
    const draft = await prisma.outreachDraft.create({
      data: {
        leadId: input.leadId,
        channel,
        message: drafted.message,
        status: "PENDING_APPROVAL",
        reasonForContacting: decision.reason,
        firstMessageGoal: drafted.goal,
        whatNotToSay: drafted.doNotSay,
        stepKind: CONVERSATION_REPLY_STEP,
        mode: "heuristic",
      },
    });
    draftId = draft.id;
  }

  const raised = raiseLeadTemperature(leadRow?.temperature, decision.heat);
  const statusPatch =
    decision.to === "BOOKED" ||
    decision.to === "MEETING_BOOKED" ||
    decision.to === "COMPLETED" ||
    decision.to === "LINK_SENT" ||
    decision.to === "MEETING_PROPOSED" ||
    decision.to === "BOOKING_STARTED"
      ? leadRow?.status === "WON" || leadRow?.status === "LOST" || leadRow?.status === "DO_NOT_CONTACT"
        ? {}
        : { status: "MEETING" as const }
      : decision.heat === "HOT" || decision.heat === "QUALIFIED"
        ? leadRow?.status === "WON" || leadRow?.status === "LOST" || leadRow?.status === "DO_NOT_CONTACT" || leadRow?.status === "MEETING"
          ? {}
          : { status: "INTERESTED" as const }
        : {};
  if (raised || Object.keys(statusPatch).length) {
    await prisma.lead.update({
      where: { id: input.leadId },
      data: {
        ...(raised ? { temperature: raised } : {}),
        ...statusPatch,
        lastActivityAt: new Date(),
      },
    });
  }
  if (booked) {
    const { haltOutreachAfterBooking } = await import("@/lib/conversation/tracking");
    await haltOutreachAfterBooking(input.leadId);
  }

  await writeAudit({
    action: decision.stopRelationship ? "conversation.stopped" : "conversation.analyzed",
    entity: "conversation",
    entityId: row.id,
    payload: {
      from,
      to: decision.to,
      cue: analysis.cue,
      intentScore: analysis.intentScore,
      heat: decision.heat,
      pitchAllowed: decision.pitchAllowed,
      draftId,
      meetingSource: sendingLink ? entry.source : conversation.meetingSource ?? null,
      meetingEntryUrl: sendingLink ? ctx.bookingUrl : null,
    },
  });

  return {
    analysis,
    decision,
    draft: drafted,
    draftId,
    conversationId: row.id,
    stopLinkedIn: shouldStopLinkedInOnReply(analysis.cue) || booked,
  };
}

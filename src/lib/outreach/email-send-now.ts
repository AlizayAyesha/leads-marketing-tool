import "server-only";
import { getBusinessProfile } from "@/lib/business/profile";

import { prisma } from "@/lib/db/prisma";
import { getActiveCampaignBrief } from "@/lib/campaigns/active-brief";
import { writeAudit } from "@/lib/db/settings";
import { HARD_DAILY_SEND_LIMIT } from "@/lib/outreach/policy";
import { DECISION_FRESH_MS } from "@/lib/outreach/gate";
import { refreshPassAuditIfNeeded } from "@/lib/outreach/audit-refresh";
import { HOME_EMAIL_WAVE_LIMIT } from "@/lib/outreach/home-email-pulse";
import { countEmailsSentToday, getOutreachEnginePolicy } from "@/lib/outreach/sequence";
import { gmailSendConnected, sendApprovedDraft } from "@/lib/outreach/send";
import { wantsOurServices } from "@/lib/outreach/wants-services";

export type EmailSendNowResult = {
  ok: boolean;
  sent: number;
  drafted: number;
  skipped: number;
  filtered: number;
  replied: number;
  blockers: string[];
  reason: string;
  targetLimit?: number;
  markedDone?: number;
};

const DONE_LEAD_STATUSES = [
  "WON",
  "LOST",
  "DO_NOT_CONTACT",
] as const;

function firstName(name: string | null | undefined, company: string | null | undefined) {
  const fromName = (name ?? "").trim().split(/\s+/)[0];
  if (fromName) return fromName;
  if (company?.trim()) return company.trim();
  return "there";
}

function techGapHint(notes: string | null | undefined, industry: string | null | undefined) {
  const blob = [notes, industry].filter(Boolean).join(" ");
  if (/ai|automation|chatbot/i.test(blob)) return "AI automation";
  if (/software|app|system/i.test(blob)) return "modern software";
  if (/website|web ?site|redesign|rebuild|outdated/i.test(blob)) return "a modern website";
  if (/seo|branding/i.test(blob)) return "digital presence upgrades";
  return "the latest technology stack";
}

/** Personalized copy: company + city + one concrete tech gap. */
function buildPersonalizedEmailCopy(lead: {
  name: string | null;
  company: string | null;
  website: string | null;
  location: string | null;
  notes: string | null;
  industry: string | null;
}) {
  const who = firstName(lead.name, lead.company);
  const city = lead.location?.trim() || null;
  const place = city ? ` in ${city}` : "";
  const company = lead.company?.trim() || "your business";
  const gap = techGapHint(lead.notes, lead.industry);
  const siteBit = lead.website ? ` (saw ${lead.website})` : "";
  return {
    subject: `${company}${city ? ` · ${city}` : ""} — quick tech note`,
    message: `Hi ${who},\n\nLooking at ${company}${place}${siteBit}, one clear opportunity is ${gap}.\n\n${getBusinessProfile().businessName} builds websites, software, and AI automation for non-tech businesses that want modern tech without the overhead. If useful, I can send a 2-minute concept tailored to ${company}.\n\n— ${getBusinessProfile().businessName}`,
  };
}

/**
 * Build or reuse a draft already APPROVED for immediate Gmail send.
 * Operator bulk never leaves PENDING drafts as the end state.
 */
async function ensureApprovedSendReadyDraft(lead: {
  id: string;
  leadId: string;
  name: string | null;
  company: string | null;
  website: string | null;
  location: string | null;
  notes: string | null;
  industry: string | null;
  email: string | null;
}) {
  const existing = await prisma.outreachDraft.findFirst({
    where: {
      leadId: lead.id,
      channel: "EMAIL",
      status: { in: ["PENDING_APPROVAL", "EDITED", "APPROVED"] },
      gmailMessageId: null,
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    if (existing.status === "APPROVED") return existing;
    return prisma.outreachDraft.update({
      where: { id: existing.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedBy: "operator-bulk-email" },
    });
  }

  const copy = buildPersonalizedEmailCopy(lead);
  await prisma.outreachDraft.updateMany({
    where: { leadId: lead.id, channel: "EMAIL", status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
    data: { status: "SUPERSEDED" },
  });
  return prisma.outreachDraft.create({
    data: {
      leadId: lead.id,
      channel: "EMAIL",
      subject: copy.subject,
      message: copy.message,
      tone: "conversational",
      status: "APPROVED",
      approvedAt: new Date(),
      approvedBy: "operator-bulk-email",
      reasonForContacting: "Filtered brief match — personalized company + city + tech gap.",
      whatNotToSay: ["Do not invent buying need."],
      followUpStrategy: "One follow-up after 4 business days if no reply.",
      stepKind: "INITIAL",
      mode: "heuristic",
      modelProvider: "heuristic-personalized",
    },
  });
}

/** After Gmail confirms: lead marked done so the row is not reused; sheet sync archives it. */
async function markEmailLeadDone(leadId: string, draftId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { notes: true } });
  const stamp = `email-sent:${new Date().toISOString().slice(0, 10)}`;
  const prior = (lead?.notes ?? "").trim();
  const notes = prior.includes("email-sent:")
    ? prior
    : prior
      ? `${prior}\n${stamp}`
      : stamp;

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: "CONTACTED",
      lastActivityAt: new Date(),
      notes,
    },
  });
  // Lead Opportunity has no status column — stamp selection so analytics can see outreach done.
  await prisma.opportunity.updateMany({
    where: { leadId, OR: [{ selection: null }, { selection: { in: ["PRIORITY", "NURTURE", "NEW"] } }] },
    data: { selection: "CONTACTED" },
  });
  await prisma.outreachDraft.updateMany({
    where: {
      leadId,
      channel: "EMAIL",
      status: { in: ["PENDING_APPROVAL", "EDITED", "APPROVED", "DRAFT"] },
      gmailMessageId: null,
      id: { not: draftId },
    },
    data: { status: "SUPERSEDED" },
  });
  await writeAudit({
    action: "outreach.email.marked_done",
    entity: "lead",
    entityId: leadId,
    payload: { draftId, status: "CONTACTED", opportunitySelection: "CONTACTED" },
  });
}

/**
 * Home "Send emails" path — live Gmail API send only.
 * Never stops at draft. Successful sends mark the lead done (no reuse).
 */
export async function runEmailSendNowWorker(input: { limit?: number } = {}): Promise<EmailSendNowResult> {
  const empty = { filtered: 0, replied: 0 };
  const policy = await getOutreachEnginePolicy();
  const blockers: string[] = [];
  if (!policy.enabled) {
    return { ok: false, sent: 0, drafted: 0, skipped: 0, ...empty, blockers: ["Outreach engine is off."], reason: "ENGINE_OFF" };
  }
  if (policy.sendsPaused) {
    return { ok: false, sent: 0, drafted: 0, skipped: 0, ...empty, blockers: ["Kill switch is on."], reason: "KILL_SWITCH" };
  }
  if (!policy.emailEnabled) {
    return { ok: false, sent: 0, drafted: 0, skipped: 0, ...empty, blockers: ["Email channel is disabled."], reason: "EMAIL_OFF" };
  }
  const gmailOk = await gmailSendConnected();
  if (!gmailOk) {
    return {
      ok: false,
      sent: 0,
      drafted: 0,
      skipped: 0,
      ...empty,
      blockers: ["Google is not connected with gmail.send. Reconnect Google with Gmail send."],
      reason: "GMAIL_NOT_CONNECTED",
    };
  }

  try {
    const { getGoogleClient } = await import("@/lib/data-sources/google");
    const { google } = await import("googleapis");
    const { client } = await getGoogleClient();
    await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/invalid_grant|invalid_client|unauthorized|token/i.test(msg)) {
      return {
        ok: false,
        sent: 0,
        drafted: 0,
        skipped: 0,
        ...empty,
        blockers: [
          "Google login expired (invalid_grant). Reconnect at /api/google/oauth?gmail=1 then click Send emails again.",
          msg.slice(0, 160),
        ],
        reason: "GMAIL_RECONNECT_REQUIRED",
      };
    }
  }

  const emailsSentToday = await countEmailsSentToday();
  const cap = Math.min(HARD_DAILY_SEND_LIMIT, Math.max(0, policy.dailySendLimit));
  const remaining = Math.max(0, cap - emailsSentToday);
  const brief = await getActiveCampaignBrief();
  const requested = Math.max(1, input.limit ?? brief.targetCount ?? HOME_EMAIL_WAVE_LIMIT);
  const limit = Math.min(remaining, requested, HOME_EMAIL_WAVE_LIMIT);
  if (remaining <= 0) {
    return {
      ok: false,
      sent: 0,
      drafted: 0,
      skipped: 0,
      ...empty,
      blockers: [`Daily email cap ${cap} already reached (${emailsSentToday} sent today).`],
      reason: "DAILY_LIMIT",
      targetLimit: limit,
    };
  }

  const alreadySent = await prisma.outreachEvent.findMany({
    where: { type: "SENT", channel: "EMAIL" },
    select: { leadId: true },
    distinct: ["leadId"],
  });
  const alreadySentIds = new Set(alreadySent.map((row) => row.leadId));

  const leads = await prisma.lead.findMany({
    where: {
      email: { not: null },
      suppressed: false,
      status: { notIn: [...DONE_LEAD_STATUSES] },
      // Prefer Decision Maker PASS inventory — avoid burning the wave on NOT_PASS noise.
      audits: { some: { verdict: "PASS" } },
      ...(alreadySentIds.size > 0 ? { id: { notIn: [...alreadySentIds] } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      audits: { orderBy: { createdAt: "desc" }, take: 1 },
      opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
      drafts: {
        where: { channel: "EMAIL", status: "SENT" },
        take: 1,
      },
    },
  });

  const readyDraftLeadIds = new Set(
    (
      await prisma.outreachDraft.findMany({
        where: {
          channel: "EMAIL",
          status: { in: ["APPROVED", "PENDING_APPROVAL", "EDITED"] },
          gmailMessageId: null,
          leadId: { in: leads.map((l) => l.id) },
        },
        select: { leadId: true },
      })
    ).map((d) => d.leadId),
  );
  leads.sort((a, b) => Number(readyDraftLeadIds.has(b.id)) - Number(readyDraftLeadIds.has(a.id)));

  let sent = 0;
  let prepared = 0;
  let skipped = 0;
  let filtered = 0;
  let markedDone = 0;
  const blockerCounts = new Map<string, number>();
  const sentLeadIds: string[] = [];

  for (const lead of leads) {
    if (sent >= limit) break;
    if (!lead.email?.trim()) {
      skipped += 1;
      continue;
    }
    if (lead.drafts[0] || alreadySentIds.has(lead.id)) {
      skipped += 1;
      blockerCounts.set("ALREADY_EMAILED", (blockerCounts.get("ALREADY_EMAILED") ?? 0) + 1);
      continue;
    }

    const audit = lead.audits[0];
    if (!audit || audit.verdict !== "PASS") {
      skipped += 1;
      blockerCounts.set("NOT_PASS", (blockerCounts.get("NOT_PASS") ?? 0) + 1);
      continue;
    }

    const refreshed = await refreshPassAuditIfNeeded(lead.id, audit, "operator bulk-email refresh");
    if (!refreshed.ok) {
      skipped += 1;
      blockerCounts.set(refreshed.code, (blockerCounts.get(refreshed.code) ?? 0) + 1);
      continue;
    }

    const wants = wantsOurServices({
      name: lead.name,
      company: lead.company,
      industry: lead.industry,
      website: lead.website,
      location: lead.location,
      email: lead.email,
      roleTitle: lead.name,
      originalPost: lead.originalPost,
      notes: lead.notes,
      serviceNeedStatus: audit.serviceNeedStatus,
      opportunitySelection: lead.opportunities[0]?.selection ?? null,
      channel: "EMAIL",
      campaignBrief: brief,
    });
    if (!wants.ok) {
      skipped += 1;
      blockerCounts.set(wants.code, (blockerCounts.get(wants.code) ?? 0) + 1);
      continue;
    }
    filtered += 1;

    try {
      const draft = await ensureApprovedSendReadyDraft(lead);
      prepared += 1;
      const result = await sendApprovedDraft(draft.id, {
        explicitApproval: true,
        operatorBulkEmail: true,
      });
      if (result.sent) {
        sent += 1;
        alreadySentIds.add(lead.id);
        sentLeadIds.push(lead.id);
        await markEmailLeadDone(lead.id, draft.id);
        markedDone += 1;
      } else {
        skipped += 1;
        const code = result.code || "SEND_BLOCKED";
        blockerCounts.set(code, (blockerCounts.get(code) ?? 0) + 1);
        if (blockers.length < 8) blockers.push(`${lead.leadId}: ${result.message}`);
        // Abort wave on auth death — do not leave a pile of "almost sent" work without saying why.
        if (code === "SEND_FAILED" && /invalid_grant|invalid_client/i.test(result.message)) {
          blockers.unshift(
            "Google login expired. Reconnect at /api/google/oauth?gmail=1 — no emails were left as drafts on purpose; retry sends them live.",
          );
          break;
        }
      }
    } catch (error) {
      skipped += 1;
      const msg = error instanceof Error ? error.message : String(error);
      if (/invalid_grant|invalid_client/i.test(msg)) {
        blockers.unshift(
          "Google login expired (invalid_grant). Reconnect at /api/google/oauth?gmail=1 then click Send emails again.",
        );
        await writeAudit({
          action: "outreach.email_send_now",
          entity: "outreach",
          payload: { sent, prepared, skipped, filtered, aborted: "GMAIL_RECONNECT_REQUIRED" },
        });
        return {
          ok: false,
          sent,
          drafted: prepared,
          skipped,
          filtered,
          replied: 0,
          blockers,
          markedDone,
          reason: "GMAIL_RECONNECT_REQUIRED",
          targetLimit: limit,
        };
      }
      blockerCounts.set("ERROR", (blockerCounts.get("ERROR") ?? 0) + 1);
      if (blockers.length < 8) blockers.push(`${lead.leadId}: ${msg}`);
    }
  }

  const replied =
    sentLeadIds.length === 0
      ? 0
      : await prisma.leadOutcome.count({
          where: {
            leadId: { in: sentLeadIds },
            replied: true,
          },
        });

  const summary = [...blockerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([code, n]) => `${code}×${n}`);
  if (summary.length) blockers.unshift(`Skip mix: ${summary.join(", ")}`);

  await writeAudit({
    action: "outreach.email_send_now",
    entity: "outreach",
    payload: {
      sent,
      prepared,
      skipped,
      filtered,
      replied,
      markedDone,
      remaining,
      limit,
      requested,
      emailsSentToday,
      cities: brief.cities,
      DECISION_FRESH_MS,
      skipMix: summary,
      mode: "live_send_mark_done",
    },
  });

  // Move cold-emailed rows off Leads → "Used already" so the next wave only sees unused data.
  let sheetNote = "";
  if (sent > 0) {
    try {
      const { syncLeadsWorkbook } = await import("@/lib/google/sync");
      const sheet = await syncLeadsWorkbook();
      sheetNote = sheet.ok
        ? ` Sheet: moved ${sheet.movedToUsed} → "Used already"; Leads now has ${sheet.exported} unused.`
        : ` Sheet sync: ${sheet.message}`;
    } catch (error) {
      sheetNote = ` Sheet sync failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const shortfall =
    sent < limit
      ? ` Wanted ${limit}, sent ${sent} live.${blockers[0] ? ` ${blockers[0]}` : ""}`
      : "";

  return {
    ok: sent > 0,
    sent,
    drafted: prepared,
    skipped,
    filtered,
    replied,
    blockers,
    markedDone,
    targetLimit: limit,
    reason:
      sent > 0
        ? `Sent ${sent} of ${limit} live via Gmail (${filtered} passed filter). Marked ${markedDone} lead(s) done — will not reuse.${sheetNote}${shortfall}`
        : `No emails sent. Filtered ${filtered}. ${blockers[0] ?? "No PASS+email candidates ready that were not already emailed."}`,
  };
}

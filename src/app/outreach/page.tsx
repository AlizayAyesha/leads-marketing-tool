import Link from "next/link";

import { getApprovalQueue, getOutreachBoard } from "@/lib/queries";
import { CHANNEL_LABEL } from "@/lib/config";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { ApprovalActions, ApproveAllBar } from "@/components/outreach/approval-actions";
import { OutreachEnginePanel } from "@/components/outreach/engine-panel";
import { LinkedInDailyPanel } from "@/components/outreach/linkedin-daily-panel";
import { TwitterDailyPanel } from "@/components/outreach/twitter-daily-panel";
import { LinkedInBlockersPanel } from "@/components/outreach/linkedin-blockers-panel";
import { ScrapedSheetPrompt } from "@/components/outreach/scraped-sheet-prompt";
import { LinkedInTestSendPanel } from "@/components/outreach/linkedin-test-panel";
import { TestRecipientPanel } from "@/components/outreach/test-recipient-panel";
import { prisma } from "@/lib/db/prisma";
import { connectionHasGmailSend } from "@/lib/outreach/send";
import { DEFAULT_TEST_SESSION, getTestRecipientSession } from "@/lib/outreach/test-recipient";
import { CONVERSATION_REPLY_STEP } from "@/lib/conversation/types";
import { LINKEDIN_CONNECT_STEP, LINKEDIN_POST_CONNECTION_STEP } from "@/lib/linkedin/connection/types";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const [drafts, board, connection, session, linkedInProspects, linkedInDaily, twitterDaily, sendProvider, linkedInBlockers] =
    await Promise.all([
    getApprovalQueue().catch(() => []),
    getOutreachBoard().catch(() => null),
    prisma.googleConnection.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null),
    getTestRecipientSession().catch(() => DEFAULT_TEST_SESSION),
    import("@/lib/linkedin/connection/queue")
      .then((mod) => mod.listLinkedInProspectQueue(new Date(), "send"))
      .catch(() => ({ connections: [], messages: [] })),
    import("@/lib/linkedin/daily/dashboard")
      .then((mod) => mod.getLinkedInDailyDashboard())
      .catch(() => null),
    import("@/lib/twitter/daily/dashboard")
      .then((mod) => mod.getTwitterDailyDashboard())
      .catch(() => null),
    import("@/lib/linkedin/send/registry")
      .then((mod) => mod.resolveLinkedInSendProvider())
      .catch(() => ({ configured: false })),
    import("@/lib/linkedin/connection/blockers")
      .then((mod) => mod.listLinkedInLeadBlockers(20))
      .catch(() => []),
  ]);
  const sheetBatch = await import("@/lib/google/sheet-batch-store")
    .then((mod) => mod.getSheetBatchStatus())
    .catch(() => ({ exhausted: false }));
  const scrapeActors = await import("@/lib/actions/actors")
    .then((mod) => mod.listLeadScrapeActors())
    .catch(() => []);
  const scrapers = await import("@/lib/actions/scraping")
    .then((mod) => mod.listZarScrapers())
    .catch(() => []);
  const gmailSendReady = connectionHasGmailSend(connection?.scopes);
  const testLead = session?.leadId
    ? await prisma.lead.findUnique({
        where: { id: session.leadId },
        select: {
          id: true,
          leadId: true,
          name: true,
          company: true,
          email: true,
          linkedinUrl: true,
          instagramUrl: true,
          suppressed: true,
          status: true,
          audits: { orderBy: { createdAt: "desc" }, take: 1, select: { verdict: true } },
          linkedinConnections: { take: 1, select: { status: true } },
        },
      })
    : null;
  const testEmailDraft = session?.emailDraftId
    ? await prisma.outreachDraft.findUnique({
        where: { id: session.emailDraftId },
        select: { id: true, subject: true, message: true },
      })
    : testLead
      ? await prisma.outreachDraft.findFirst({
          where: {
            leadId: testLead.id,
            channel: "EMAIL",
            stepKind: "TEST_TRANSPORT",
            status: { in: ["PENDING_APPROVAL", "APPROVED", "EDITED"] },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, subject: true, message: true },
        })
      : null;

  const linkedinQueue = drafts.filter(
    (draft) => draft.stepKind === LINKEDIN_CONNECT_STEP || draft.stepKind === LINKEDIN_POST_CONNECTION_STEP,
  );
  const otherQueue = drafts.filter(
    (draft) => draft.stepKind !== LINKEDIN_CONNECT_STEP && draft.stepKind !== LINKEDIN_POST_CONNECTION_STEP,
  );
  const orderedDrafts = [...linkedinQueue, ...otherQueue];
  const eligibleCount = orderedDrafts.filter((draft) => {
    const isReply = draft.stepKind === "REPLY" || draft.stepKind === CONVERSATION_REPLY_STEP;
    return isReply || draft.lead.audits[0]?.verdict === "PASS";
  }).length;

  return (
    <div>
      <PageHeader
        eyebrow="Outreach engine"
        title="Sequences and approval"
        description="Discover → Enrich → Research → Qualify → Rank → Connection. Decision Maker PASS plus commercial relevance — a LinkedIn URL is not enough. Daily caps are ceilings, not quotas. Follow-ups stop on reply. Sends stay behind the kill switch."
      />
      <ApproveAllBar eligibleCount={eligibleCount} pendingCount={orderedDrafts.length} />
      <ScrapedSheetPrompt exhausted={sheetBatch.exhausted} actors={scrapeActors} scrapers={scrapers} />
      {board ? (
        <>
          {linkedInDaily ? (
            <LinkedInDailyPanel
              dashboard={linkedInDaily}
              pendingConnections={linkedinQueue.filter((draft) => draft.stepKind === LINKEDIN_CONNECT_STEP).length}
              pendingMessages={linkedinQueue.filter((draft) => draft.stepKind === LINKEDIN_POST_CONNECTION_STEP).length}
              rankedConnections={linkedInProspects.connections}
              rankedMessages={linkedInProspects.messages}
            />
          ) : null}
          {twitterDaily ? <TwitterDailyPanel dashboard={twitterDaily} /> : null}
          <LinkedInBlockersPanel rows={linkedInBlockers} />
          <OutreachEnginePanel
            policy={board.policy}
            sentToday={board.sentToday}
            gmailSendReady={gmailSendReady}
            googleEmail={connection?.googleEmail ?? null}
          />
        </>
      ) : null}
      <TestRecipientPanel
        session={session}
        recipient={testLead}
        emailDraft={testEmailDraft}
        gmailSendReady={gmailSendReady}
        policy={board?.policy ?? { sendsPaused: true, sendMode: "draft_only" }}
        googleEmail={connection?.googleEmail ?? null}
      />
      <LinkedInTestSendPanel
        session={session}
        recipient={
          testLead
            ? {
                id: testLead.id,
                leadId: testLead.leadId,
                name: testLead.name,
                company: testLead.company,
                linkedinUrl: testLead.linkedinUrl,
                decisionMaker: testLead.audits[0]?.verdict ?? null,
                connectionStatus: testLead.linkedinConnections[0]?.status ?? null,
              }
            : null
        }
        policy={board?.policy ?? { sendsPaused: true }}
        send={{
          sendReady: sendProvider.configured,
        }}
      />
      {board && board.testSequenceCount ? (
        <p className="mb-6 text-xs text-muted">
          TEST / E2E DATA hidden from this view: {board.testSequenceCount} active test sequence
          {board.testSequenceCount === 1 ? "" : "s"}. Harness records stay in the database for automated tests.
        </p>
      ) : null}
      {board && board.sequences.length ? (
        <section className="mb-8 glass rounded-2xl p-5">
          <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Active sequences</h2>
          <div className="space-y-2 text-sm">
            {board.sequences.map((sequence) => (
              <div key={sequence.id} className="flex flex-wrap justify-between gap-2 border-b border-white/5 pb-2">
                <span>
                  {sequence.lead.company || sequence.lead.name || sequence.lead.leadId} · {sequence.channel} · step{" "}
                  {sequence.currentStep + 1}/4
                </span>
                <Badge tone={sequence.status === "ACTIVE" ? "default" : "muted"}>{sequence.status}</Badge>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {board && board.replies.length ? (
        <section className="mb-8 glass rounded-2xl p-5">
          <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Recent replies</h2>
          <div className="space-y-2 text-sm">
            {board.replies.map((reply) => (
              <div key={reply.id} className="flex flex-wrap justify-between gap-2 border-b border-white/5 pb-2">
                <span>
                  {reply.lead.company || reply.lead.name} · {reply.intent}
                  {reply.escalated ? " · escalated" : ""}
                </span>
                <span className="text-muted">{reply.summary}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {drafts.length === 0 ? (
        <EmptyState
          title="Nothing waiting for approval"
          description="Run the pipeline on researched leads to generate evidence-based drafts. HOLD/REJECT never appear as sendable."
        />
      ) : (
        <div className="space-y-5">
          {orderedDrafts.map((draft) => {
            const verdict = draft.lead.audits[0]?.verdict ?? null;
            const isReply = draft.stepKind === "REPLY";
            const isConversation = draft.stepKind === CONVERSATION_REPLY_STEP;
            const isLinkedInConnect = draft.stepKind === LINKEDIN_CONNECT_STEP;
            const isLinkedInMessage = draft.stepKind === LINKEDIN_POST_CONNECTION_STEP;
            const eligible = isReply || isConversation || verdict === "PASS";
            const ineligibleReason = eligible
              ? null
              : verdict
                ? `Decision Maker ${verdict}. This lead is not eligible for outreach.`
                : "Decision Maker has not PASS'd this lead. Drafts cannot be approved.";
            return (
            <article key={draft.id} className="glass rounded-2xl p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/leads/${draft.lead.id}`} className="font-[family-name:var(--font-syne)] text-xl">
                    {draft.lead.company || draft.lead.name || draft.lead.leadId}
                  </Link>
                  <p className="mt-1 text-sm text-muted">
                    {CHANNEL_LABEL[draft.channel]} · {draft.lead.email || draft.lead.linkedinUrl || "channel identity on file"}
                    {isReply ? " · reply" : ""}
                    {isConversation ? " · conversation suggestion" : ""}
                    {isLinkedInConnect ? " · connection recommendation" : ""}
                    {isLinkedInMessage ? " · post-connection message draft" : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {isLinkedInConnect ? <Badge>Connect rec</Badge> : null}
                  {isLinkedInMessage ? <Badge>Message rec</Badge> : null}
                  {isConversation ? <Badge>Conversation</Badge> : null}
                  {verdict ? (
                    <Badge tone={verdict === "PASS" ? "default" : verdict === "HOLD" ? "WARM" : "DISQUALIFIED"}>
                      Decision Maker {verdict}
                    </Badge>
                  ) : (
                    <Badge tone="DISQUALIFIED">Decision Maker missing</Badge>
                  )}
                  {draft.lead.suppressed || draft.lead.status === "DO_NOT_CONTACT" ? (
                    <Badge tone="DISQUALIFIED">Do not contact</Badge>
                  ) : null}
                  <Badge tone={draft.lead.temperature ?? "muted"}>{draft.lead.temperature ?? "unscored"}</Badge>
                  <Badge>{draft.lead.scores[0]?.score ?? "—"}</Badge>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="text-sm">
                  <p className="text-xs uppercase tracking-wider text-muted">Why they passed/failed</p>
                  <p className="mt-1">{draft.lead.audits[0]?.summary ?? "No Decision Maker reason yet."}</p>
                  <p className="mt-3 text-xs uppercase tracking-wider text-muted">Business problem</p>
                  <p className="mt-1">{draft.lead.opportunities[0]?.problem ?? "—"}</p>
                  <p className="mt-3 text-xs uppercase tracking-wider text-muted">Personalization evidence</p>
                  <p className="mt-1">{draft.lead.opportunities[0]?.evidence ?? draft.reasonForContacting}</p>
                  <p className="mt-3 text-xs uppercase tracking-wider text-muted">Channel / sequence / reply</p>
                  <p className="mt-1">
                    {CHANNEL_LABEL[draft.channel]} · {draft.stepKind ?? "INITIAL"} · lead {draft.lead.status.replaceAll("_", " ")}
                  </p>
                  <p className="mt-3 text-xs uppercase tracking-wider text-muted">Approval status</p>
                  <p className="mt-1">{draft.status.replaceAll("_", " ")}</p>
                </div>
                <div className="lg:col-span-2">
                  {draft.subject ? <p className="mb-2 text-sm text-emerald-100">{draft.subject}</p> : null}
                  <pre className="whitespace-pre-wrap rounded-xl bg-black/30 p-4 font-sans text-sm">
                    {draft.message}
                  </pre>
                </div>
              </div>
              <ApprovalActions
                draftId={draft.id}
                message={draft.message}
                subject={draft.subject}
                eligible={eligible}
                ineligibleReason={ineligibleReason}
              />
            </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

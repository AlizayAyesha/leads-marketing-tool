"use client";

import Link from "next/link";
import { useState } from "react";

import {
  runHomeChannelAction,
  runLiveOutreachAction,
} from "@/lib/actions/outreach";
import { runFullScrapeThenSheetAction } from "@/lib/actions/scraping";
import { formatDiscoverDoneBanner } from "@/lib/scraping/discover-report-types";
import { summarizeLiveRun } from "@/lib/outreach/live-run-copy";
import { ScrapedSheetPrompt } from "@/components/outreach/scraped-sheet-prompt";
import {
  ScrapeNowControls,
  type LeadScrapeActorOption,
  type ZarScraperOption,
} from "@/components/outreach/scrape-now-controls";
import { Button } from "@/components/ui/button";
import { TaskRunBanner, useTaskRun } from "@/components/ui/task-run-status";

function ChannelCard({
  title,
  ready,
  sent,
  hint,
  actionLabel,
  pendingLabel,
  pending,
  disabled,
  onClick,
}: {
  title: string;
  ready: string;
  sent: string;
  hint?: string;
  actionLabel: string;
  pendingLabel: string;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="font-[family-name:var(--font-syne)] text-base text-white">{title}</p>
      <p className="mt-2 text-sm text-emerald-100">
        <span className="text-muted">Ready </span>
        {ready}
      </p>
      <p className="text-sm text-emerald-100">
        <span className="text-muted">Today </span>
        {sent}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
      <div className="mt-auto pt-4">
        <Button className="w-full" disabled={disabled} onClick={onClick}>
          {pending ? pendingLabel : actionLabel}
        </Button>
      </div>
    </div>
  );
}

function GateChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        ok
          ? "rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-100"
          : "rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-100"
      }
    >
      {ok ? "●" : "○"} {label}
    </span>
  );
}

export function HomeOutreachControl({
  twitterDailyOn,
  twitterCanSend,
  chromeConnected,
  sheetExhausted,
  scrapeActors = [],
  scrapers = [],
  lastLeadsWritten = 0,
  draftOnly = true,
  killSwitchOn = true,
  socialAutomation = false,
  gmailSendReady = false,
  emailPulse,
  socialPulse,
}: {
  twitterDailyOn: boolean;
  twitterCanSend: boolean;
  chromeConnected: boolean;
  sheetExhausted?: boolean;
  scrapeActors?: LeadScrapeActorOption[];
  scrapers?: ZarScraperOption[];
  lastLeadsWritten?: number;
  draftOnly?: boolean;
  killSwitchOn?: boolean;
  /** LinkedIn / X send cards. Off unless ENABLE_SOCIAL_AUTOMATION=true. */
  socialAutomation?: boolean;
  gmailSendReady?: boolean;
  emailPulse?: {
    emailsSentToday: number;
    dailyCap: number;
    remainingToday: number;
    waveLimit: number;
    readyEmails?: number;
    lastSkipHint?: string | null;
    repliedTotal?: number;
    lastWave: {
      sent: number;
      drafted: number;
      skipped: number;
      filtered?: number;
      replied?: number;
      at: string;
      reason?: string;
    } | null;
  } | null;
  socialPulse?: {
    linkedin: {
      connectionsToday: number;
      messagesToday: number;
      connectionCap: number;
      messageCap: number;
      readyConnections?: number;
      readyMessages?: number;
      skipMix?: string[];
    };
    twitter: {
      dmsToday: number;
      followsToday: number;
      dmCap: number;
      readyDms?: number;
      skipMix?: string[];
    };
  } | null;
}) {
  const discover = useTaskRun();
  const live = useTaskRun();
  const channel = useTaskRun("home-social-send");
  const liConnect = useTaskRun("home-linkedin-connect");
  const liMessage = useTaskRun("home-linkedin-message");
  const emailRun = useTaskRun("home-email-send");
  const [liveEmail, setLiveEmail] = useState<{
    waveSent: number;
    waveFiltered?: number;
    waveReplied?: number;
    repliedTotal?: number;
    emailsSentToday: number;
    dailyCap: number;
    remainingToday: number;
    waveLimit: number;
  } | null>(null);
  const [liveSocial, setLiveSocial] = useState<{
    linkedin?: { connections: number; messages: number; connectionsToday: number; messagesToday: number };
    twitter?: { follows: number; dms: number; followsToday: number; dmsToday: number };
  }>({});

  const emailsSentToday = liveEmail?.emailsSentToday ?? emailPulse?.emailsSentToday ?? 0;
  const dailyCap = liveEmail?.dailyCap ?? emailPulse?.dailyCap ?? 100;
  const remainingToday = liveEmail?.remainingToday ?? emailPulse?.remainingToday ?? 0;
  const waveLimit = liveEmail?.waveLimit ?? emailPulse?.waveLimit ?? 10;
  const lastWaveSent = liveEmail?.waveSent ?? emailPulse?.lastWave?.sent ?? null;
  const lastWaveFiltered = liveEmail?.waveFiltered ?? emailPulse?.lastWave?.filtered ?? null;

  const liConnToday = liveSocial.linkedin?.connectionsToday ?? socialPulse?.linkedin.connectionsToday ?? 0;
  const liMsgToday = liveSocial.linkedin?.messagesToday ?? socialPulse?.linkedin.messagesToday ?? 0;
  const liConnCap = socialPulse?.linkedin.connectionCap ?? 10;
  const liMsgCap = socialPulse?.linkedin.messageCap ?? 10;
  const liReadyConn = socialPulse?.linkedin.readyConnections ?? 0;
  const liReadyMsg = socialPulse?.linkedin.readyMessages ?? 0;
  const liSkipMix = socialPulse?.linkedin.skipMix ?? [];
  const twDmToday = liveSocial.twitter?.dmsToday ?? socialPulse?.twitter.dmsToday ?? 0;
  const twFollowToday = liveSocial.twitter?.followsToday ?? socialPulse?.twitter.followsToday ?? 0;
  const twDmCap = socialPulse?.twitter.dmCap ?? 10;
  const twReady = socialPulse?.twitter.readyDms ?? 0;
  const twSkipMix = socialPulse?.twitter.skipMix ?? [];
  const emailReady = emailPulse?.readyEmails ?? Math.min(waveLimit, remainingToday);
  const emailSkipHint = emailPulse?.lastSkipHint ?? null;
  const emailReadyLabel = gmailSendReady ? `${emailReady} ready` : "No sender connected";
  const emailHint = gmailSendReady
    ? (emailSkipHint ??
      (lastWaveSent != null
        ? `Last wave: ${lastWaveFiltered ?? 0} filtered · ${lastWaveSent} sent`
        : remainingToday > 0
          ? `${remainingToday} left today`
          : "Daily cap reached"))
    : "Gmail send: missing. Connect Google before sending.";

  const busy = discover.pending || live.pending || channel.pending || liConnect.pending || liMessage.pending || emailRun.pending;
  const canSend = !killSwitchOn;

  return (
    <>
      <ScrapedSheetPrompt exhausted={Boolean(sheetExhausted)} actors={scrapeActors} scrapers={scrapers} />

      <section className="mb-8 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-[family-name:var(--font-syne)] text-xl text-white">Today&apos;s work</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Find buyers → send from here → check what went out. Agencies and tech peers are filtered out.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <GateChip ok={!killSwitchOn} label={killSwitchOn ? "Sends paused" : "Sends on"} />
            {socialAutomation ? (
              <GateChip ok={chromeConnected} label={chromeConnected ? "Chrome ready" : "Chrome opens on send"} />
            ) : null}
            {!draftOnly ? <GateChip ok label="Live mode" /> : null}
          </div>
        </div>

        {/* Step 1 — Find */}
        <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-400/80">1 · Find</p>
          <p className="mt-1 text-sm text-muted">Discover new leads into your leads list, or use people you already imported.</p>
          <p className="mt-1 text-xs text-muted">
            Find leads runs Apify searches on your own Apify key and uses your Apify credits.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                discover.run(async () => {
                  const report = await runFullScrapeThenSheetAction();
                  const lines = [
                    report.message,
                    ...report.steps.map(
                      (step) => `${step.name}: ${step.ok ? "ok" : "failed"} (${step.attempts} try) · ${step.detail}`,
                    ),
                  ];
                  if (!report.ok) throw new Error(lines.join("\n"));
                  return [
                    formatDiscoverDoneBanner({
                      discovery: report.discovery,
                      classification: report.classification,
                    }),
                    ...lines,
                  ];
                })
              }
            >
              {discover.pending ? "Finding…" : "Find leads"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                live.run(async () => {
                  const report = await runLiveOutreachAction();
                  return summarizeLiveRun(report);
                })
              }
            >
              {live.pending ? "Preparing…" : "Prepare only (no send)"}
            </Button>
            {lastLeadsWritten > 0 ? (
              <span className="text-xs text-muted">Last sheet write: {lastLeadsWritten} rows</span>
            ) : null}
          </div>
          <TaskRunBanner phase={discover.phase} lines={discover.lines} />
          <TaskRunBanner phase={live.phase} lines={live.lines} />
        </div>

        {/* Step 2 — Send */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-400/80">2 · Send</p>
          <p className="mt-1 text-sm text-muted">
            {canSend
              ? socialAutomation
                ? "Each click sends up to 10. Watch Jarvis Chrome for LinkedIn and X."
                : "Each click sends up to 10 emails."
              : "Turn the kill switch off in Outreach before sending."}
          </p>
          {!canSend ? (
            <p className="mt-2 text-sm text-amber-100">
              Sends are paused.{" "}
              <Link href="/outreach" className="underline underline-offset-2">
                Open Outreach
              </Link>{" "}
              {socialAutomation ? "to turn Daily on and clear the kill switch." : "to clear the kill switch."}
            </p>
          ) : null}

          <div className={socialAutomation ? "mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" : "mt-4 grid max-w-md gap-3"}>
            {socialAutomation ? (
            <>
            <ChannelCard
              title="LinkedIn connect"
              ready={`${liReadyConn} buyers`}
              sent={`${liConnToday} / ${liConnCap}`}
              hint={liSkipMix.length ? `Skipped: ${liSkipMix.slice(0, 3).join(", ")}` : undefined}
              actionLabel="Connect ≤10"
              pendingLabel="Connecting…"
              pending={liConnect.pending}
              disabled={busy || !canSend}
              onClick={() =>
                liConnect.run(async () => {
                  const result = await runHomeChannelAction("linkedin-connect");
                  const social = result.social;
                  if (social && social.channel === "linkedin") {
                    setLiveSocial((prev) => ({
                      ...prev,
                      linkedin: {
                        connections: social.connections ?? 0,
                        messages: prev.linkedin?.messages ?? 0,
                        connectionsToday: social.connectionsToday ?? 0,
                        messagesToday: social.messagesToday ?? prev.linkedin?.messagesToday ?? 0,
                      },
                    }));
                  }
                  if (!result.ok) throw new Error(result.lines.join("\n"));
                  return result.lines;
                })
              }
            />
            <ChannelCard
              title="LinkedIn message"
              ready={`${liReadyMsg} connected`}
              sent={`${liMsgToday} / ${liMsgCap}`}
              hint={
                liveSocial.linkedin
                  ? `Last: ${liveSocial.linkedin.connections} connects · ${liveSocial.linkedin.messages} msgs`
                  : undefined
              }
              actionLabel="Message ≤10"
              pendingLabel="Messaging…"
              pending={liMessage.pending}
              disabled={busy || !canSend}
              onClick={() =>
                liMessage.run(async () => {
                  const result = await runHomeChannelAction("linkedin-message");
                  const social = result.social;
                  if (social && social.channel === "linkedin") {
                    setLiveSocial((prev) => ({
                      ...prev,
                      linkedin: {
                        connections: prev.linkedin?.connections ?? 0,
                        messages: social.messages ?? 0,
                        connectionsToday: social.connectionsToday ?? prev.linkedin?.connectionsToday ?? 0,
                        messagesToday: social.messagesToday ?? 0,
                      },
                    }));
                  }
                  if (!result.ok) throw new Error(result.lines.join("\n"));
                  return result.lines;
                })
              }
            />
            <ChannelCard
              title="X (Twitter)"
              ready={`${twReady} buyers`}
              sent={`${twFollowToday} follows · ${twDmToday}/${twDmCap} DMs`}
              hint={
                twSkipMix.length
                  ? `Skipped: ${twSkipMix.slice(0, 3).join(", ")}`
                  : twitterDailyOn && !twitterCanSend
                    ? "Sign into x.com in Jarvis Chrome"
                    : undefined
              }
              actionLabel="DM ≤10"
              pendingLabel="Sending…"
              pending={channel.pending}
              disabled={busy || !canSend}
              onClick={() =>
                channel.run(async () => {
                  const result = await runHomeChannelAction("twitter");
                  const social = result.social;
                  if (social && social.channel === "twitter") {
                    setLiveSocial((prev) => ({
                      ...prev,
                      twitter: {
                        follows: social.follows ?? 0,
                        dms: social.dms ?? 0,
                        followsToday: social.followsToday ?? 0,
                        dmsToday: social.dmsToday ?? 0,
                      },
                    }));
                  }
                  if (!result.ok) throw new Error(result.lines.join("\n"));
                  return result.lines;
                })
              }
            />
            </>
            ) : null}
            <ChannelCard
              title="Email"
              ready={emailReadyLabel}
              sent={`${emailsSentToday} / ${dailyCap}`}
              hint={emailHint}
              actionLabel={
                !gmailSendReady ? "No sender" : remainingToday <= 0 ? "Cap reached" : `Email ≤${Math.min(waveLimit, remainingToday)}`
              }
              pendingLabel="Sending…"
              pending={emailRun.pending}
              disabled={busy || !canSend || !gmailSendReady || remainingToday <= 0}
              onClick={() =>
                emailRun.run(async () => {
                  const result = await runHomeChannelAction("email");
                  if (result.email) {
                    setLiveEmail({
                      waveSent: result.email.waveSent,
                      waveFiltered: result.email.waveFiltered,
                      waveReplied: result.email.waveReplied,
                      repliedTotal: result.email.repliedTotal,
                      emailsSentToday: result.email.emailsSentToday,
                      dailyCap: result.email.dailyCap,
                      remainingToday: result.email.remainingToday,
                      waveLimit: result.email.waveLimit,
                    });
                  }
                  if (!result.ok) throw new Error(result.lines.join("\n"));
                  return result.lines;
                })
              }
            />
          </div>

          {socialAutomation ? <TaskRunBanner phase={channel.phase} lines={channel.lines} /> : null}
          {socialAutomation ? <TaskRunBanner phase={liConnect.phase} lines={liConnect.lines} /> : null}
          {socialAutomation ? <TaskRunBanner phase={liMessage.phase} lines={liMessage.lines} /> : null}
          <TaskRunBanner phase={emailRun.phase} lines={emailRun.lines} />
        </div>

        {/* Step 3 — More */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Link href="/integrations/scraping" className="text-emerald-300 hover:underline">
            Elite Scraper
          </Link>
          <Link href="/leads" className="text-emerald-300 hover:underline">
            Leads
          </Link>
          <Link href="/outreach" className="text-emerald-300 hover:underline">
            Approvals &amp; status
          </Link>
          {socialAutomation ? (
            <Link href="/integrations/browser" className="text-emerald-300 hover:underline">
              Chrome
            </Link>
          ) : null}
          <details className="w-full pt-1">
            <summary className="cursor-pointer text-muted hover:text-emerald-200">Advanced: website engines &amp; Apify</summary>
            <div className="mt-3">
              <ScrapeNowControls scrapers={scrapers} actors={scrapeActors} hideFlagship />
            </div>
          </details>
        </div>
      </section>
    </>
  );
}

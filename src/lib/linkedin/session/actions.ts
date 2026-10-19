import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { LinkedInBrowserPage } from "@/lib/browser/linkedin-page";
import { flashCursorStatus, jarvisCursorStatus } from "@/lib/browser/visible-cursor";
import { extractLinkedInPublicIdentifier, inspectLinkedInUrl } from "@/lib/linkedin/url";
import { inspectLinkedInPage, type LinkedInProfileInspection } from "@/lib/linkedin/session/inspect";
import type { LinkedInActionEvidence, LinkedInSendKind, LinkedInSendRequest, LinkedInSendResult } from "@/lib/linkedin/send/types";

export const CHROME_LINKEDIN_PROVIDER_ID = "chrome-linkedin-session";

const INVITE_NOTE_LIMIT = 200;

function evidenceDir() {
  return path.join(process.cwd(), ".jarvis", "linkedin-evidence");
}

export async function captureLinkedInEvidence(input: {
  page: LinkedInBrowserPage;
  leadId: string;
  profileUrl: string;
  action: LinkedInSendKind | "status" | "inbox";
  inspected: LinkedInProfileInspection;
}): Promise<LinkedInActionEvidence> {
  await mkdir(evidenceDir(), { recursive: true }).catch(() => undefined);
  const screenshotPath = path.join(evidenceDir(), `${input.leadId}-${input.action}-${Date.now()}.png`);
  const saved = await input.page.screenshot(screenshotPath);
  return {
    leadId: input.leadId,
    profileUrl: input.profileUrl,
    action: input.action,
    at: new Date().toISOString(),
    result: input.inspected.code,
    observedState: input.inspected.state,
    profileId: extractLinkedInPublicIdentifier(input.page.url()) ?? extractLinkedInPublicIdentifier(input.profileUrl),
    excerpt: (await input.page.innerText().catch(() => "")).slice(0, 800) || null,
    screenshotPath: saved,
    url: input.page.url(),
    title: await input.page.title().catch(() => null),
  };
}

function fail(
  request: LinkedInSendRequest,
  code: string,
  reason: string,
  evidence?: LinkedInActionEvidence,
): LinkedInSendResult {
  return {
    ok: false,
    sent: false,
    code,
    reason,
    provider: CHROME_LINKEDIN_PROVIDER_ID,
    externalId: evidence?.profileId ?? extractLinkedInPublicIdentifier(request.profileUrl),
    evidence,
  };
}

function okSend(
  request: LinkedInSendRequest,
  code: string,
  reason: string,
  evidence?: LinkedInActionEvidence,
): LinkedInSendResult {
  return {
    ok: true,
    sent: true,
    code,
    reason,
    provider: CHROME_LINKEDIN_PROVIDER_ID,
    externalId: evidence?.profileId ?? extractLinkedInPublicIdentifier(request.profileUrl),
    evidence,
  };
}

async function openProfile(page: LinkedInBrowserPage, profileUrl: string) {
  const inspectedUrl = inspectLinkedInUrl(profileUrl);
  if (inspectedUrl.kind !== "person" || !inspectedUrl.normalizedUrl) {
    return { ok: false as const, code: "NOT_PERSON_URL", reason: "LinkedIn account actions need a person profile URL." };
  }
  await page.goto(inspectedUrl.normalizedUrl);
  return { ok: true as const, url: inspectedUrl.normalizedUrl };
}

async function dismissNonInviteDialogs(page: LinkedInBrowserPage) {
  await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
    for (const dialog of dialogs) {
      const text = ((dialog as HTMLElement).innerText || dialog.textContent || "").toLowerCase();
      const isShare =
        /copy link to post|send .+['’]?s post|share via/i.test(text) &&
        !/add a note|send without a note|send invitation/i.test(text);
      if (!isShare) continue;
      const close =
        dialog.querySelector<HTMLElement>('button[aria-label*="Dismiss" i], button[aria-label*="Close" i]') ||
        Array.from(dialog.querySelectorAll("button")).find((btn) =>
          /dismiss|close/i.test(btn.getAttribute("aria-label") || ""),
        );
      close?.click();
    }
  });
  await page.wait(300);
}

/**
 * Click Connect on the *profile* top card only.
 * Never use page-wide Connect — that hits sidebar "People you may know".
 */
async function clickConnect(page: LinkedInBrowserPage) {
  await dismissNonInviteDialogs(page);
  if (await page.clickTopCardAction("connect")) return true;

  // Playwright fallbacks scoped to main, excluding aside.
  const mainScopes = ["main .pv-top-card", "main .pvs-profile-actions", "main > section", "main section.artdeco-card"];
  for (const scope of mainScopes) {
    if (
      await page.clickScopedButton(scope, /Invite .+ to connect/i, { roles: ["button", "link"] })
    ) {
      return true;
    }
  }
  for (const scope of mainScopes) {
    if (await page.clickScopedButton(scope, /^Connect$/i, { roles: ["button", "link"] })) {
      return true;
    }
  }

  const openedMore =
    (await page.clickTopCardAction("more")) ||
    (await page.clickScopedButton("main .pv-top-card", /More actions|^More$/i, { roles: ["button"] })) ||
    (await page.clickScopedButton("main .pvs-profile-actions", /More actions|^More$/i, { roles: ["button"] })) ||
    (await page.clickScopedButton("main > section", /More actions|^More$/i, { roles: ["button"] }));
  if (openedMore) {
    await page.wait(800);
    if (await page.clickOverflowConnect()) return true;
    if (await page.clickScopedButton('[role="menu"]', /Invite .+ to connect|\bConnect\b/i, { roles: ["menuitem", "button"] })) {
      return true;
    }
    if (
      await page.clickScopedButton(".artdeco-dropdown__content", /Invite .+ to connect|\bConnect\b/i, {
        roles: ["button", "menuitem"],
      })
    ) {
      return true;
    }
  }
  return false;
}

async function waitForProfileStatuses(page: LinkedInBrowserPage) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const inspected = await inspectLinkedInPage(page);
    if (
      inspected.state === "AUTH_REQUIRED" ||
      inspected.state === "CONNECTED" ||
      inspected.state === "REQUESTED" ||
      inspected.state === "NOT_REQUESTED" ||
      inspected.buttons.connect ||
      inspected.buttons.pending ||
      inspected.buttons.follow ||
      inspected.buttons.message
    ) {
      return inspected;
    }
    await page.wait(500);
  }
  return inspectLinkedInPage(page);
}

async function inviteDialogPresent(page: LinkedInBrowserPage) {
  // Playwright role/name is more reliable than DOM guesses for LinkedIn modals.
  if (await page.hasVisibleButton(/Send without a note/i)) return true;
  if (await page.hasVisibleButton(/Add a note to your invitation|Personalize your invitation/i)) return true;
  if ((await page.hasVisibleButton(/^Add a note$/i)) && (await page.hasVisibleButton(/^Send$/i))) return true;
  const hit = await page.evaluate(() => {
    const textOf = (el: Element) => ((el as HTMLElement).innerText || el.textContent || "").toLowerCase();
    return Array.from(
      document.querySelectorAll("[role='dialog'], .artdeco-modal, .artdeco-modal__content, div.send-invite"),
    ).some((dialog) => {
      const text = textOf(dialog);
      if (/copy link to post|send .+['’]?s post/i.test(text)) return false;
      return /add a note to your invitation|send without a note|personalize your invitation|how do you know/i.test(
        text,
      );
    });
  });
  return Boolean(hit);
}

async function completeInvitation(page: LinkedInBrowserPage, note: string) {
  // Give the invite modal a moment; some profiles flip straight to Pending with no modal.
  for (let i = 0; i < 12; i += 1) {
    if (await inviteDialogPresent(page)) break;
    const actions = await page.readTopCardActions();
    if (actions.pending) return true;
    await page.wait(400);
  }
  const actions = await page.readTopCardActions();
  if (actions.pending) return true;
  if (!(await inviteDialogPresent(page))) return false;

  const trimmed = note.replace(/\s+/g, " ").trim().slice(0, INVITE_NOTE_LIMIT);
  if (trimmed) {
    if (
      (await page.clickScopedButton('[role="dialog"]', /Add a note/i, { roles: ["button"] })) ||
      (await page.clickScopedButton(".artdeco-modal", /Add a note/i, { roles: ["button"] })) ||
      (await page.clickButton(/^Add a note$/i))
    ) {
      await page.wait(400);
      const filled = await page.fillInvitationNote(trimmed);
      if (!filled) return false;
    }
  }

  // Primary CTA — Playwright first (LinkedIn modal markup varies; often outside `main`).
  if (await page.clickButton(/Send without a note/i)) return true;
  if (await page.clickTextContaining("Send without a note")) return true;
  if (await page.clickInviteDialogSend()) return true;
  for (const scope of ['[role="dialog"]', ".artdeco-modal", ".artdeco-modal__actionbar", "div.send-invite"]) {
    if (await page.clickScopedButton(scope, /Send without a note/i, { roles: ["button"] })) return true;
  }
  for (const scope of ['[role="dialog"]', ".artdeco-modal"]) {
    if (await page.clickScopedButton(scope, /^Send invitation$|^Send now$|^Send$/i, { roles: ["button"] })) {
      return true;
    }
  }
  return false;
}

export async function executeLinkedInSend(page: LinkedInBrowserPage, request: LinkedInSendRequest): Promise<LinkedInSendResult> {
  const opened = await openProfile(page, request.profileUrl);
  if (!opened.ok) return fail(request, opened.code, opened.reason);

  if (request.kind === "connection") return sendConnection(page, request);
  return sendMessage(page, request);
}

async function sendConnection(page: LinkedInBrowserPage, request: LinkedInSendRequest): Promise<LinkedInSendResult> {
  const before = await waitForProfileStatuses(page);
  const beforeEvidence = await captureLinkedInEvidence({
    page,
    leadId: request.leadId,
    profileUrl: request.profileUrl,
    action: "connection",
    inspected: before,
  });
  if (before.rateLimited) {
    await flashCursorStatus(page, jarvisCursorStatus("Rate limited"));
    return fail(request, "RATE_LIMITED", "LinkedIn reported an invitation limit. No connection was recorded as sent.", beforeEvidence);
  }
  if (before.state === "AUTH_REQUIRED") {
    await flashCursorStatus(page, jarvisCursorStatus("Sign in required"));
    return fail(request, "AUTH_REQUIRED", before.reason, beforeEvidence);
  }
  if (before.state === "REQUESTED" || before.buttons.pending) {
    await flashCursorStatus(page, jarvisCursorStatus("Already invited"));
    return fail(request, "ALREADY_INVITED", "LinkedIn already shows Pending. REQUESTED is not CONNECTED.", beforeEvidence);
  }

  // Always try Connect (including More → Connect). Do not trust page-wide "1st" alone.
  await flashCursorStatus(page, jarvisCursorStatus("Connect"));
  let clicked = await clickConnect(page);
  if (clicked) {
    await page.wait(1200);
    // False-positive guard: “People similar” Connect used to satisfy clickConnect.
    const mid = await page.readTopCardActions();
    const inviteUp = await inviteDialogPresent(page);
    if (!inviteUp && !mid.pending && mid.connect) {
      clicked = false;
    }
  }
  if (!clicked) {
    const afterClick = await inspectLinkedInPage(page);
    const evidence = await captureLinkedInEvidence({
      page,
      leadId: request.leadId,
      profileUrl: request.profileUrl,
      action: "connection",
      inspected: afterClick,
    });
    // before already gated Pending — new Pending means the invite landed (More→Connect can race).
    if (afterClick.state === "REQUESTED" || afterClick.buttons.pending) {
      await flashCursorStatus(page, jarvisCursorStatus("Invite sent"));
      return okSend(request, "REQUESTED", "LinkedIn showed Pending after the connection request.", evidence);
    }
    if (/invitation sent|invite sent/i.test(evidence.excerpt ?? "")) {
      await flashCursorStatus(page, jarvisCursorStatus("Invite sent"));
      return okSend(request, "REQUESTED", "LinkedIn showed an invitation-sent confirmation.", evidence);
    }
    const strongConnected =
      afterClick.buttons.message &&
      !afterClick.buttons.connect &&
      !afterClick.buttons.pending &&
      !afterClick.buttons.follow;
    if (strongConnected || afterClick.state === "CONNECTED") {
      await flashCursorStatus(page, jarvisCursorStatus("Skip — already connected"));
      return fail(
        request,
        "ALREADY_CONNECTED",
        "Connect not found (including under More); Message without Follow — already connected. Invite was not sent.",
        evidence,
      );
    }
    await flashCursorStatus(page, jarvisCursorStatus("No Connect option"));
    return fail(
      request,
      "NO_CONNECT_OPTION",
      "Connect control was not found (including under More). Nothing was recorded as sent.",
      evidence,
    );
  }

  let completed = await completeInvitation(page, request.body);
  // Pending / invite modal can lag after Connect — keep trying Send while dialog is up.
  let after = await waitForProfileStatuses(page);
  for (let i = 0; i < 10; i += 1) {
    if (after.state === "REQUESTED" || after.buttons.pending || after.rateLimited) break;
    if (await inviteDialogPresent(page)) {
      completed = (await completeInvitation(page, request.body)) || completed;
      await page.wait(500);
    }
    const wall = (await page.innerText().catch(() => "")).toLowerCase();
    if (/invitation sent|invite sent/i.test(wall)) break;
    await page.wait(600);
    after = await inspectLinkedInPage(page);
  }
  const evidence = await captureLinkedInEvidence({
    page,
    leadId: request.leadId,
    profileUrl: request.profileUrl,
    action: "connection",
    inspected: after,
  });
  if (after.rateLimited) {
    await flashCursorStatus(page, jarvisCursorStatus("Rate limited"));
    return fail(request, "RATE_LIMITED", "LinkedIn reported an invitation limit after Connect. Not recorded as sent.", evidence);
  }
  const pendingConfirmed =
    after.state === "REQUESTED" ||
    after.buttons.pending ||
    /invitation sent|invite sent/i.test(evidence.excerpt ?? "");
  if (!completed && !pendingConfirmed) {
    await flashCursorStatus(page, jarvisCursorStatus("Send not confirmed"));
    return fail(request, "SEND_NOT_CONFIRMED", "Connect was clicked but LinkedIn did not show Pending or Send confirmation.", evidence);
  }
  if (!pendingConfirmed) {
    await flashCursorStatus(page, jarvisCursorStatus("Send not confirmed"));
    return fail(request, "SEND_NOT_CONFIRMED", "LinkedIn did not show Pending after the invite. Not recorded as sent.", evidence);
  }
  await flashCursorStatus(page, jarvisCursorStatus("Invite sent"));
  return okSend(request, "REQUESTED", "LinkedIn showed Pending after the connection request.", evidence);
}

async function sendMessage(page: LinkedInBrowserPage, request: LinkedInSendRequest): Promise<LinkedInSendResult> {
  const before = await inspectLinkedInPage(page);
  const beforeEvidence = await captureLinkedInEvidence({
    page,
    leadId: request.leadId,
    profileUrl: request.profileUrl,
    action: "message",
    inspected: before,
  });
  if (before.state === "AUTH_REQUIRED") {
    return fail(request, "AUTH_REQUIRED", before.reason, beforeEvidence);
  }
  if (before.state !== "CONNECTED") {
    return fail(
      request,
      "NOT_CONNECTED",
      `${before.state} is not CONNECTED. Jarvis will not send a LinkedIn message until first-degree is confirmed.`,
      beforeEvidence,
    );
  }

  const opened = (await page.clickButton(/^Message$/i)) || (await page.clickButton(/^Message\b/i));
  await page.wait(2000);
  for (let i = 0; i < 6; i += 1) {
    if (/\/messaging\//i.test(page.url())) break;
    const text = await page.innerText().catch(() => "");
    if (/write a message/i.test(text)) break;
    await page.wait(400);
  }

  if (!/\/messaging\//i.test(page.url())) {
    const hrefs = await page.collectHrefs("/messaging/");
    const compose = hrefs.find((href) => /messaging\/(compose|thread)/i.test(href));
    if (compose) {
      const absolute = compose.startsWith("http") ? compose : `https://www.linkedin.com${compose}`;
      await page.goto(absolute);
      await page.wait(1500);
    }
  }

  if (!/\/messaging\//i.test(page.url())) {
    const recipientId = await page.findRecipientId();
    if (recipientId) {
      await page.goto(
        `https://www.linkedin.com/messaging/thread/new/?recipient=${encodeURIComponent(recipientId)}`,
      );
      await page.wait(2000);
    }
  }

  if (!opened && !/\/messaging\//i.test(page.url())) {
    return fail(request, "MESSAGE_NOT_FOUND", "Message control was not found. Nothing was recorded as sent.", beforeEvidence);
  }

  const filled = await page.fillComposer(request.body);
  if (!filled) {
    const afterOpen = await inspectLinkedInPage(page);
    return fail(
      request,
      "COMPOSER_NOT_FOUND",
      "Message composer was not found. Nothing was recorded as sent.",
      await captureLinkedInEvidence({
        page,
        leadId: request.leadId,
        profileUrl: request.profileUrl,
        action: "message",
        inspected: afterOpen,
      }),
    );
  }
  const sentClick = (await page.clickButton(/^Send$/i)) || (await page.clickButton(/^Send message$/i));
  if (!sentClick) {
    return fail(request, "SEND_NOT_CONFIRMED", "Send control was not clicked. Nothing was recorded as sent.", beforeEvidence);
  }
  await page.wait(1000);
  const thread = await page.innerText();
  const evidence = await captureLinkedInEvidence({
    page,
    leadId: request.leadId,
    profileUrl: request.profileUrl,
    action: "message",
    inspected: await inspectLinkedInPage(page),
  });
  const bodySnippet = request.body.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!bodySnippet || !thread.replace(/\s+/g, " ").includes(bodySnippet)) {
    return fail(request, "SEND_NOT_CONFIRMED", "Message did not appear in the LinkedIn thread. Not recorded as sent.", evidence);
  }
  return okSend(request, "SENT", "LinkedIn thread showed the sent message.", evidence);
}

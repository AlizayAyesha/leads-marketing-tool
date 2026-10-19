import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  fillTwitterDmComposer,
  TWITTER_FOLLOW_BUTTON,
  TWITTER_SEND_BUTTON,
  clickTwitterDmButton,
  clickTwitterProfileButton,
  openTwitterChatComposer,
  type TwitterBrowserPage,
} from "@/lib/browser/twitter-page";
import { inspectTwitterUrl } from "@/lib/twitter/url";
import { inspectTwitterPage, type TwitterProfileInspection } from "@/lib/twitter/session/inspect";
import type { TwitterActionEvidence, TwitterSendRequest, TwitterSendResult } from "@/lib/twitter/send/types";

export const CHROME_TWITTER_PROVIDER_ID = "chrome-twitter-session";

function evidenceDir() {
  return path.join(process.cwd(), ".jarvis", "twitter-evidence");
}

export async function captureTwitterEvidence(input: {
  page: TwitterBrowserPage;
  leadId: string;
  profileUrl: string;
  action: string;
  inspected: TwitterProfileInspection;
  followed?: boolean;
}): Promise<TwitterActionEvidence> {
  await mkdir(evidenceDir(), { recursive: true }).catch(() => undefined);
  const screenshotPath = path.join(evidenceDir(), `${input.leadId}-${input.action}-${Date.now()}.png`);
  const saved = await input.page.screenshot(screenshotPath);
  const handle = inspectTwitterUrl(input.profileUrl).handle;
  return {
    leadId: input.leadId,
    profileUrl: input.profileUrl,
    action: input.action,
    at: new Date().toISOString(),
    result: input.inspected.code,
    observedState: input.inspected.state,
    handle,
    excerpt: (await input.page.innerText().catch(() => "")).slice(0, 800) || null,
    screenshotPath: saved,
    url: input.page.url(),
    title: await input.page.title().catch(() => null),
    followed: input.followed === true,
  };
}

function fail(
  request: TwitterSendRequest,
  code: string,
  reason: string,
  evidence?: TwitterActionEvidence,
): TwitterSendResult {
  return {
    ok: false,
    sent: false,
    code,
    reason,
    provider: CHROME_TWITTER_PROVIDER_ID,
    externalId: evidence?.handle ?? inspectTwitterUrl(request.profileUrl).handle,
    evidence,
  };
}

function okSend(
  request: TwitterSendRequest,
  code: string,
  reason: string,
  evidence?: TwitterActionEvidence,
): TwitterSendResult {
  return {
    ok: true,
    sent: true,
    code,
    reason,
    provider: CHROME_TWITTER_PROVIDER_ID,
    externalId: evidence?.handle ?? inspectTwitterUrl(request.profileUrl).handle,
    evidence,
  };
}

async function openProfile(page: TwitterBrowserPage, profileUrl: string) {
  const inspected = inspectTwitterUrl(profileUrl);
  if (inspected.kind !== "person" || !inspected.url) {
    return { ok: false as const, code: "NOT_PERSON_URL", reason: "X DMs need a person profile URL (x.com/handle)." };
  }
  await page.goto(inspected.url);
  await page.wait(2500);
  return { ok: true as const, url: inspected.url, handle: inspected.handle };
}

async function waitForProfileActions(page: TwitterBrowserPage) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const inspected = await inspectTwitterPage(page);
    if (
      inspected.state === "AUTH_REQUIRED" ||
      inspected.state === "RATE_LIMITED" ||
      inspected.state === "CAN_MESSAGE" ||
      inspected.state === "NEEDS_FOLLOW" ||
      inspected.state === "DM_NOT_ALLOWED"
    ) {
      return inspected;
    }
    await page.wait(750);
  }
  return inspectTwitterPage(page);
}

async function confirmMessageInThread(page: TwitterBrowserPage, body: string) {
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 40);
  if (!snippet) return false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const url = page.url().toLowerCase();
    // Fail closed on public compose — never treat a tweet draft as a DM send.
    if (/\/compose\/post|\/compose\/tweet/.test(url)) return false;
    if (!/\/(messages|i\/chat)/.test(url)) {
      await page.wait(500);
      continue;
    }
    // Dismiss X Number gate if it blocks the thread UI.
    await page.clickButton(/not now/i);
    const text = await page.innerText().catch(() => "");
    if (text.includes(snippet)) return true;
    await page.wait(600);
  }
  return false;
}

function xNumberGateVisible(text: string) {
  return /enter .+ x number to contact|use x number/i.test(text);
}

async function typeAndSendDm(
  page: TwitterBrowserPage,
  request: TwitterSendRequest,
  body: string,
  opened: { url: string; handle: string | null },
  followed: boolean,
  via: "profile" | "chat",
): Promise<TwitterSendResult> {
  const urlBefore = page.url().toLowerCase();
  if (/\/compose\/post|\/compose\/tweet/.test(urlBefore)) {
    const evidence = await captureTwitterEvidence({
      page,
      leadId: request.leadId,
      profileUrl: opened.url,
      action: "dm",
      inspected: await inspectTwitterPage(page),
      followed,
    });
    return fail(
      request,
      "LANDED_ON_PUBLIC_COMPOSE",
      "X opened public post compose instead of a DM thread. Nothing was sent.",
      evidence,
    );
  }

  const filled = await fillTwitterDmComposer(page, body);
  if (!filled) {
    const evidence = await captureTwitterEvidence({
      page,
      leadId: request.leadId,
      profileUrl: opened.url,
      action: "dm",
      inspected: await inspectTwitterPage(page),
      followed,
    });
    return fail(request, "COMPOSER_FAILED", "Could not type into the X DM composer.", evidence);
  }

  let sentClick =
    (await page.clickButton(TWITTER_SEND_BUTTON)) ||
    Boolean(
      await page.evaluate(() => {
        const btn =
          document.querySelector<HTMLElement>('[data-testid="dmComposerSendButton"]') ||
          document.querySelector<HTMLElement>('button[aria-label*="Send" i]');
        if (!btn) return false;
        btn.click();
        return true;
      }),
    );
  if (!sentClick) {
    // Chat often uses an icon-only send control — Enter after focus on the real composer only.
    await page.evaluate(() => {
      const el =
        document.querySelector<HTMLElement>('[data-testid="dmComposerTextInput"]') ||
        document.querySelector<HTMLElement>('[data-testid="dm-composer-textarea"]') ||
        document.querySelector<HTMLElement>('div[role="textbox"][data-testid*="dm" i]');
      el?.focus();
      return true;
    });
    await page.wait(200);
    sentClick = await page.clickButton(/send/i);
  }
  await page.wait(1200);
  await page.clickButton(/not now/i);
  await page.wait(800);

  const confirmed = await confirmMessageInThread(page, body);
  const pageText = await page.innerText().catch(() => "");
  const evidence = await captureTwitterEvidence({
    page,
    leadId: request.leadId,
    profileUrl: opened.url,
    action: "dm",
    inspected: await inspectTwitterPage(page),
    followed,
  });

  if (!confirmed) {
    return fail(
      request,
      xNumberGateVisible(pageText) ? "X_NUMBER_REQUIRED" : "SEND_UNCONFIRMED",
      xNumberGateVisible(pageText)
        ? "X asked for the recipient's X Number after compose. Message may be held — not recorded as confirmed."
        : "Send was attempted but the DM body was not confirmed in the thread. Not recorded as sent.",
      evidence,
    );
  }

  if (xNumberGateVisible(pageText)) {
    // Visible in our thread, but X is gating further contact.
    return okSend(
      request,
      "SENT_X_NUMBER_GATE",
      "DM appears in Chat, but X is prompting for the recipient's X Number.",
      evidence,
    );
  }

  return okSend(
    request,
    "SENT",
    via === "chat"
      ? "X DM confirmed via Chat composer in Jarvis Chrome."
      : "X DM confirmed in thread via Jarvis Chrome.",
    evidence,
  );
}

/**
 * Auto-DM on X via Jarvis Chrome. No manual mouse.
 * Prefer Chat compose (new X UI); fall back to profile Message if visible.
 */
export async function executeTwitterDm(
  page: TwitterBrowserPage,
  request: TwitterSendRequest,
): Promise<TwitterSendResult> {
  const body = request.body.replace(/\s+/g, " ").trim();
  if (!body) {
    return fail(request, "EMPTY_BODY", "DM body is empty. Nothing was sent.");
  }

  const opened = await openProfile(page, request.profileUrl);
  if (!opened.ok) return fail(request, opened.code, opened.reason);

  let inspected = await waitForProfileActions(page);
  if (inspected.state === "AUTH_REQUIRED") {
    const evidence = await captureTwitterEvidence({
      page,
      leadId: request.leadId,
      profileUrl: opened.url,
      action: "dm",
      inspected,
    });
    return fail(request, "AUTH_REQUIRED", inspected.reason, evidence);
  }
  if (inspected.state === "RATE_LIMITED") {
    const evidence = await captureTwitterEvidence({
      page,
      leadId: request.leadId,
      profileUrl: opened.url,
      action: "dm",
      inspected,
    });
    return fail(request, "RATE_LIMITED", inspected.reason, evidence);
  }

  let followed = false;
  // Always follow when Follow is available — home target is ~10 follows + ~10 DMs.
  if (
    (inspected.buttons.follow && !inspected.buttons.following) ||
    inspected.state === "NEEDS_FOLLOW"
  ) {
    const clickedFollow = await clickTwitterProfileButton(page, TWITTER_FOLLOW_BUTTON);
    if (clickedFollow) {
      followed = true;
      await page.wait(2000);
      inspected = await waitForProfileActions(page);
    }
  }

  // Chat-first: profile Message is often missing on modern X.
  const chat = await openTwitterChatComposer(page, opened.handle ?? "");
  if (chat.ok) {
    return typeAndSendDm(page, request, body, opened, followed, "chat");
  }

  if (inspected.buttons.message || inspected.state === "CAN_MESSAGE") {
    const openedMessage = await clickTwitterDmButton(page);
    if (openedMessage) {
      await page.wait(1200);
      return typeAndSendDm(page, request, body, opened, followed, "profile");
    }
  }

  const evidence = await captureTwitterEvidence({
    page,
    leadId: request.leadId,
    profileUrl: opened.url,
    action: "dm",
    inspected,
    followed,
  });
  return fail(
    request,
    chat.code,
    followed
      ? `Followed once; Chat/Message failed: ${chat.reason}`
      : `Chat/Message failed: ${chat.reason}`,
    evidence,
  );
}

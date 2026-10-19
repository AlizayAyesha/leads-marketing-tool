/**
 * X / Twitter browser page helpers.
 * Jarvis Chrome runOnPage already wraps Playwright; we reuse the same click/fill surface
 * as LinkedIn (generic buttons + contenteditable) with X-oriented composer selectors.
 */
import type { LinkedInBrowserPage } from "@/lib/browser/linkedin-page";

export type TwitterBrowserPage = LinkedInBrowserPage;

/** Profile actions live here — not the left nav "Follow" link. */
export const TWITTER_PROFILE_SCOPE = '[data-testid="primaryColumn"]';

/** Real DM composers only — never the New message recipient search bar. */
export const TWITTER_DM_COMPOSER_SELECTORS = [
  '[data-testid="dmComposerTextInput"]',
  '[data-testid="dm-composer-textarea"]',
  'div[role="textbox"][data-testid*="dm" i]',
  'textarea[data-testid*="dm" i]',
  '[contenteditable="true"][data-testid="dmComposerTextInput"]',
  '[contenteditable="true"][aria-label*="Start a message" i]',
  '[contenteditable="true"][aria-label*="Write a message" i]',
  '[contenteditable="true"][aria-label^="Message" i]',
] as const;

export const TWITTER_DM_SEARCH_SELECTORS = [
  '[data-testid="new-dm-search-input"]',
  'input[data-testid="searchPeople"]',
  'input[data-testid="searchPeopleInline"]',
  'input[aria-label*="Search name or username" i]',
  'input[aria-label*="Search people" i]',
  'input[aria-label*="Search for people" i]',
  'input[aria-label*="Search by name" i]',
  'input[placeholder*="Search name or username" i]',
  'input[placeholder*="Search people" i]',
  'input[placeholder*="Search for people" i]',
  'input[placeholder*="Type a name" i]',
  '[role="dialog"] input[type="text"]',
  '[role="dialog"] input:not([type="hidden"])',
  '[data-testid="TypeaheadDialog"] input',
] as const;

export type TwitterDmFieldKind = "composer" | "search" | "other";

/**
 * Classify an X field from attributes. Used to keep DM body out of the recipient search bar.
 */
export function classifyTwitterDmField(input: {
  testId?: string | null;
  ariaLabel?: string | null;
  placeholder?: string | null;
  role?: string | null;
  tagName?: string | null;
}): TwitterDmFieldKind {
  const testId = (input.testId ?? "").toLowerCase();
  const aria = (input.ariaLabel ?? "").toLowerCase();
  const placeholder = (input.placeholder ?? "").toLowerCase();
  const blob = `${testId} ${aria} ${placeholder}`;

  if (
    /new-dm-search|searchpeople|search.?people|search name or username|search for people|type a name/.test(blob)
  ) {
    return "search";
  }
  if (/^search(\b|$)/.test(aria) || /^search(\b|$)/.test(placeholder)) {
    return "search";
  }
  if (
    /dmcomposer|dm-composer|dmcomposertextinput|dm-composer-textarea/.test(testId) ||
    /start a (new )?message|write a message|send a message/.test(aria) ||
    (/^message\b/.test(aria) && !/search/.test(aria))
  ) {
    return "composer";
  }
  if (testId.includes("dm") && (input.role === "textbox" || (input.tagName ?? "").toLowerCase() === "textarea")) {
    return "composer";
  }
  return "other";
}

/** Shared DOM probe — true only when a real DM composer exists and search is not the only focusable field. */
export function twitterDmComposerProbeScript() {
  return () => {
    const searchHit = Boolean(
      document.querySelector('[data-testid="new-dm-search-input"]') ||
        document.querySelector('input[aria-label*="Search name or username" i]') ||
        document.querySelector('input[placeholder*="Search name or username" i]') ||
        document.querySelector('input[aria-label*="Search people" i]'),
    );
    const composer =
      document.querySelector<HTMLElement>('[data-testid="dmComposerTextInput"]') ||
      document.querySelector<HTMLElement>('[data-testid="dm-composer-textarea"]') ||
      document.querySelector<HTMLElement>('div[role="textbox"][data-testid*="dm" i]') ||
      document.querySelector<HTMLElement>('textarea[data-testid*="dm" i]') ||
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[contenteditable="true"][aria-label], textarea[aria-label], div[role="textbox"][aria-label]',
        ),
      ).find((el) => {
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        const testId = (el.getAttribute("data-testid") || "").toLowerCase();
        if (/search|people|username/.test(`${aria} ${testId}`)) return false;
        return /start a (new )?message|write a message|send a message|^message\b/.test(aria) || /dmcomposer|dm-composer/.test(testId);
      }) ||
      null;
    return {
      composerReady: Boolean(composer),
      searchVisible: searchHit,
      stillOnRecipientSearch: searchHit && !composer,
    };
  };
}

async function typeIntoDmComposerElement(
  page: TwitterBrowserPage,
  text: string,
): Promise<boolean> {
  return Boolean(
    await page.evaluate((body) => {
      const rejectSearch = (el: Element | null) => {
        if (!el) return true;
        const testId = (el.getAttribute("data-testid") || "").toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        const placeholder = (
          el.getAttribute("placeholder") ||
          el.getAttribute("aria-placeholder") ||
          ""
        ).toLowerCase();
        const blob = `${testId} ${aria} ${placeholder}`;
        return /new-dm-search|searchpeople|search.?people|search name or username|search for people|type a name|^search(\b|$)/.test(
          blob,
        );
      };

      const pick = (): HTMLElement | null => {
        const preferred = [
          document.querySelector<HTMLElement>('[data-testid="dmComposerTextInput"]'),
          document.querySelector<HTMLElement>('[data-testid="dm-composer-textarea"]'),
          document.querySelector<HTMLElement>('div[role="textbox"][data-testid*="dm" i]'),
          document.querySelector<HTMLElement>('textarea[data-testid*="dm" i]'),
        ].find((el) => el && !rejectSearch(el));
        if (preferred) return preferred;

        const labeled = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[contenteditable="true"][aria-label], textarea[aria-label], div[role="textbox"][aria-label]',
          ),
        ).find((el) => {
          if (rejectSearch(el)) return false;
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          return /start a (new )?message|write a message|send a message|^message\b/.test(aria);
        });
        return labeled ?? null;
      };

      const el = pick();
      if (!el || rejectSearch(el)) return false;

      el.focus();
      el.click();
      document.execCommand("selectAll", false);
      document.execCommand("delete", false);
      const ok = document.execCommand("insertText", false, body);
      if (!ok) {
        if ("value" in el) {
          (el as HTMLTextAreaElement).value = body;
        } else {
          el.textContent = body;
        }
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: body, inputType: "insertText" }));

      // Fail closed if the recipient search absorbed the body instead.
      const search =
        document.querySelector<HTMLInputElement>('[data-testid="new-dm-search-input"]') ||
        document.querySelector<HTMLInputElement>('input[aria-label*="Search" i]');
      const searchVal = (search?.value || search?.textContent || "").replace(/\s+/g, " ");
      const snippet = body.slice(0, Math.min(24, body.length));
      if (searchVal.includes(snippet)) return false;

      const seen = (el.innerText || ("value" in el ? String((el as HTMLTextAreaElement).value) : "") || el.textContent || "").replace(
        /\s+/g,
        " ",
      );
      return seen.includes(snippet);
    }, text),
  );
}

export async function fillTwitterDmComposer(page: TwitterBrowserPage, text: string): Promise<boolean> {
  const onChatOrMessages = /\/(messages|i\/chat)/i.test(page.url());

  // Never paste a DM body while the New message recipient search is still the only field.
  if (onChatOrMessages) {
    const probe = await page.evaluate(twitterDmComposerProbeScript());
    if (probe?.stillOnRecipientSearch) {
      return false;
    }
  }

  for (const selector of TWITTER_DM_COMPOSER_SELECTORS) {
    if (await page.fillSelector(selector, text)) {
      // Guard: if search somehow received the paste, treat as failure.
      const leaked = await page.evaluate((input: { snippet: string }) => {
        const search =
          document.querySelector<HTMLInputElement>('[data-testid="new-dm-search-input"]') ||
          document.querySelector<HTMLInputElement>('input[aria-label*="Search name or username" i]') ||
          document.querySelector<HTMLInputElement>('input[aria-label*="Search people" i]');
        if (!search) return false;
        const val = (search.value || search.textContent || "").replace(/\s+/g, " ");
        return val.includes(input.snippet);
      }, { snippet: text.slice(0, Math.min(24, text.length)) });
      if (leaked) return false;
      return true;
    }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await typeIntoDmComposerElement(page, text)) return true;
    await page.wait(700);
  }

  // Do NOT fall back to generic fillComposer on Chat/Messages — LinkedIn-style
  // contenteditable selectors match the New message search bar and paste the DM there.
  if (onChatOrMessages) {
    return false;
  }

  if (await page.fillComposer(text)) return true;
  await page.wait(800);
  return page.fillComposer(text);
}

export const TWITTER_MESSAGE_BUTTON = /^Message/i;
export const TWITTER_FOLLOW_BUTTON = /^Follow/i;
export const TWITTER_FOLLOWING_BUTTON = /^(Following|Unfollow)/i;
export const TWITTER_SEND_BUTTON = /^(Send|Send message)$/i;

export async function hasTwitterProfileButton(page: TwitterBrowserPage, name: RegExp) {
  return page.hasScopedButton(TWITTER_PROFILE_SCOPE, name, { roles: ["button"] });
}

export async function clickTwitterProfileButton(page: TwitterBrowserPage, name: RegExp) {
  return page.clickScopedButton(TWITTER_PROFILE_SCOPE, name, { roles: ["button"] });
}

export async function hasTwitterDmButton(page: TwitterBrowserPage) {
  if (await hasTwitterProfileButton(page, TWITTER_MESSAGE_BUTTON)) return true;
  return page.hasScopedButton(TWITTER_PROFILE_SCOPE, /message/i, { roles: ["button", "link"] });
}

export async function clickTwitterDmButton(page: TwitterBrowserPage) {
  if (await clickTwitterProfileButton(page, TWITTER_MESSAGE_BUTTON)) return true;
  return page.clickScopedButton(TWITTER_PROFILE_SCOPE, /message/i, { roles: ["button", "link"] });
}

/**
 * Modern X often hides profile Message. Fall back to Chat → New message → search handle.
 */
export async function openTwitterChatComposer(
  page: TwitterBrowserPage,
  handle: string,
): Promise<{ ok: boolean; code: string; reason: string }> {
  const clean = handle.replace(/^@/, "").trim();
  if (!clean) {
    return { ok: false, code: "NO_HANDLE", reason: "Missing X handle for Chat compose." };
  }

  await page.goto("https://x.com/i/chat");
  await page.wait(2500);

  const wall = (await page.innerText().catch(() => "")).toLowerCase();
  const urlNow = page.url().toLowerCase();
  if (/\/i\/chat\/pin\/recovery|enter passcode|recover your encryption keys|set passcode/.test(`${urlNow}\n${wall}`)) {
    return {
      ok: false,
      code: "CHAT_PASSCODE_REQUIRED",
      reason:
        "X Chat needs the encryption passcode entered in Jarvis Chrome (Enter Passcode / pin recovery). Unlock Chat once, then retry.",
    };
  }

  const opened =
    (await page.clickButton(/new chat/i)) ||
    (await page.clickButton(/start conversation|start a conversation/i)) ||
    (await page.clickButton(/new message/i)) ||
    (await page.clickButton(/^message$/i));
  if (!opened) {
    return { ok: false, code: "CHAT_COMPOSE_FAILED", reason: "Could not open X Chat new-message composer." };
  }
  await page.wait(1500);

  const afterOpen = (await page.innerText().catch(() => "")).toLowerCase();
  const afterUrl = page.url().toLowerCase();
  if (/\/i\/chat\/pin\/recovery|enter passcode|recover your encryption keys/.test(`${afterUrl}\n${afterOpen}`)) {
    return {
      ok: false,
      code: "CHAT_PASSCODE_REQUIRED",
      reason:
        "X opened Enter Passcode (encryption key recovery) when starting a new chat. Enter the passcode in Jarvis Chrome, then retry.",
    };
  }

  let searched = false;
  for (const sel of TWITTER_DM_SEARCH_SELECTORS) {
    if (await page.fillSelector(sel, clean)) {
      searched = true;
      break;
    }
  }
  if (!searched) {
    searched =
      (await page.fillPlaceholder(/search name or username|search people|search for people|type a name|search by name/i, clean)) ||
      (await page.fillPlaceholder(/search name or username|search people|type a name/i, `@${clean}`));
  }
  // Last resort: focus whatever search-ish field is visible and type via keyboard/evaluate.
  if (!searched) {
    searched = Boolean(
      await page.evaluate((handleValue) => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(
            'input, textarea, div[contenteditable="true"], div[role="textbox"]',
          ),
        ).filter((el) => {
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const meta = `${el.getAttribute("data-testid") || ""} ${el.getAttribute("aria-label") || ""} ${
            (el as HTMLInputElement).placeholder || ""
          } ${el.getAttribute("role") || ""}`.toLowerCase();
          return /search|people|username|recipient|to:|type a name|new-dm/.test(meta) || el.tagName === "INPUT";
        });
        const el = candidates[0];
        if (!el) return false;
        el.focus();
        if ("value" in el) {
          (el as HTMLInputElement).value = handleValue;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        el.textContent = handleValue;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: handleValue }));
        return true;
      }, clean),
    );
  }
  if (!searched) {
    // Classic compose URL sometimes still works when Chat search DOM drifts.
    await page.goto(`https://x.com/messages/compose?recipient_id=&text=`);
    await page.wait(2000);
    for (const sel of TWITTER_DM_SEARCH_SELECTORS) {
      if (await page.fillSelector(sel, clean)) {
        searched = true;
        break;
      }
    }
  }
  if (!searched) {
    return { ok: false, code: "CHAT_SEARCH_FAILED", reason: "Could not type the recipient into X Chat search." };
  }
  await page.wait(2500);

  const selected =
    (await page.clickTextContaining(clean)) ||
    (await page.clickButton(new RegExp(`@${clean}\\b`, "i"))) ||
    (await page.clickButton(new RegExp(`\\b${clean}\\b`, "i"))) ||
    (await page.clickScopedButton(
      '[role="dialog"], [role="listbox"], [data-testid="TypeaheadDialog"], main',
      new RegExp(clean, "i"),
      { roles: ["button", "link", "option"] },
    ));
  if (!selected) {
    return {
      ok: false,
      code: "CHAT_RECIPIENT_NOT_FOUND",
      reason: `Could not select @${clean} from X Chat search results.`,
    };
  }
  await page.wait(1500);

  await page.clickButton(/^next$/i);
  await page.wait(1500);

  const url = page.url().toLowerCase();
  if (/\/compose\/post|\/compose\/tweet/.test(url)) {
    return {
      ok: false,
      code: "CHAT_LANDED_ON_POST",
      reason: "X opened public post compose instead of Chat. Nothing was sent.",
    };
  }
  if (/\/i\/chat\/pin\/recovery/.test(url)) {
    return {
      ok: false,
      code: "CHAT_PASSCODE_REQUIRED",
      reason: "Still on X Chat passcode recovery. Enter the passcode in Jarvis Chrome first.",
    };
  }

  // Cold contacts often hit "Enter @handle's X Number" instead of a composer.
  let threadWall = (await page.innerText().catch(() => "")).toLowerCase();
  if (/enter .+ x number to contact|use x number/.test(threadWall)) {
    await page.clickButton(/not now/i);
    await page.wait(1000);
    threadWall = (await page.innerText().catch(() => "")).toLowerCase();
  }

  let probe = await page.evaluate(twitterDmComposerProbeScript());
  // Recipient picker still open — never treat search as composer.
  if (probe?.stillOnRecipientSearch) {
    // One more Next attempt in case selection didn't advance.
    await page.clickButton(/^next$/i);
    await page.wait(1500);
    probe = await page.evaluate(twitterDmComposerProbeScript());
  }

  if (probe?.stillOnRecipientSearch) {
    return {
      ok: false,
      code: "CHAT_STILL_ON_SEARCH",
      reason: `X Chat is still on the recipient search for @${clean}. Refusing to paste the DM into the search bar.`,
    };
  }

  if (!probe?.composerReady) {
    if (/enter .+ x number to contact|use x number/.test(threadWall)) {
      return {
        ok: false,
        code: "X_NUMBER_REQUIRED",
        reason: `X requires @${clean}'s X Number before DMs. Composer unavailable.`,
      };
    }
    if (/read-only mode/i.test(threadWall)) {
      return {
        ok: false,
        code: "CHAT_READ_ONLY",
        reason: `X marked the chat with @${clean} as read-only. Composer unavailable.`,
      };
    }
    return {
      ok: false,
      code: "CHAT_NO_COMPOSER",
      reason: `Opened chat for @${clean} but no DM composer appeared.`,
    };
  }

  return { ok: true, code: "CHAT_OPEN", reason: "X Chat composer ready." };
}

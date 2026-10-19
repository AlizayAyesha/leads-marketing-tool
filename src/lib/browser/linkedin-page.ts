import {
  clickLocatorVisible,
  ensureVisibleCursor,
  flashCursorStatus,
  jarvisCursorLabel,
  moveVisibleCursor,
} from "@/lib/browser/visible-cursor";
import {
  runLinkedInTopCardCommand,
  type LinkedInDomClickHit,
  type LinkedInTopCardCommand,
} from "@/lib/linkedin/session/top-card-dom";

export type LinkedInBrowserPage = {
  url(): string;
  title(): Promise<string>;
  goto(url: string): Promise<string>;
  innerText(): Promise<string>;
  screenshot(path: string): Promise<string | null>;
  hasVisibleButton(name: RegExp): Promise<boolean>;
  clickButton(name: RegExp): Promise<boolean>;
  hasScopedButton(scope: string, name: RegExp, options?: { roles?: string[] }): Promise<boolean>;
  clickScopedButton(scope: string, name: RegExp, options?: { roles?: string[] }): Promise<boolean>;
  fillComposer(text: string): Promise<boolean>;
  fillPlaceholder(pattern: RegExp, text: string): Promise<boolean>;
  fillSelector(selector: string, text: string): Promise<boolean>;
  clickTextContaining(text: string): Promise<boolean>;
  evaluate<T, A = unknown>(fn: (arg: A) => T, arg?: A): Promise<T | null>;
  fillInvitationNote(text: string): Promise<boolean>;
  collectHrefs(fragment: string): Promise<string[]>;
  findRecipientId(): Promise<string | null>;
  readTopCardActions(): Promise<import("@/lib/linkedin/session/top-card-dom").LinkedInTopCardActions>;
  clickTopCardAction(kind: "connect" | "more" | "message"): Promise<boolean>;
  clickOverflowConnect(): Promise<boolean>;
  clickInviteDialogSend(): Promise<boolean>;
  wait(ms: number): Promise<void>;
};

type PlaywrightLocator = {
  first(): PlaywrightLocator;
  locator(selector: string): PlaywrightLocator;
  getByRole(role: string, opts?: { name?: RegExp | string }): PlaywrightLocator;
  getByText(text: string | RegExp): PlaywrightLocator;
  nth(index: number): PlaywrightLocator;
  click(opts?: { force?: boolean }): Promise<void>;
  fill(value: string): Promise<void>;
  isVisible(): Promise<boolean>;
  innerText(): Promise<string>;
  count(): Promise<number>;
  getAttribute(name: string): Promise<string | null>;
  scrollIntoViewIfNeeded?: () => Promise<void>;
  boundingBox?: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
};

type PlaywrightLikePage = {
  url(): string;
  title(): Promise<string>;
  goto(url: string, opts?: object): Promise<unknown>;
  locator(selector: string): PlaywrightLocator;
  getByRole(role: string, opts?: { name?: RegExp | string }): PlaywrightLocator;
  getByPlaceholder?(text: string | RegExp): PlaywrightLocator;
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<unknown>;
  keyboard?: { type: (text: string, opts?: { delay?: number }) => Promise<void> };
  mouse?: { move: (x: number, y: number, opts?: { steps?: number }) => Promise<unknown>; wheel?: (x: number, y: number) => Promise<unknown> };
  evaluate?<T, A = unknown>(fn: (arg: A) => T, arg?: A): Promise<T>;
};

async function clickNamedControl(page: PlaywrightLikePage, name: RegExp) {
  const label = roughLabel(name);
  const scoped = [
    // Global / modal first — invite CTAs render outside `main` in a portal.
    page.getByRole("button", { name }),
    page.locator(`[role='dialog'] button:has-text("${label}")`),
    page.locator(`.artdeco-modal button:has-text("${label}")`),
    page.locator(`button:has-text("${label}")`),
    page.locator(`button:text-is("${label}")`),
    page.getByRole("link", { name }),
    page.getByRole("menuitem", { name }),
    page.locator('[role="menu"]').getByRole("button", { name }),
    page.locator('[role="menu"]').getByText(name),
    page.locator("main").getByRole("button", { name }),
    page.locator("main").getByRole("link", { name }),
    page.locator(".pv-top-card").getByRole("button", { name }),
    page.locator(".ph5").getByRole("button", { name }),
    page.locator(".pvs-profile-actions").getByRole("button", { name }),
    page.locator(`main button:text-matches("${label}", "i")`),
    page.locator(`main a:text-matches("${label}", "i")`),
    page.locator(`[aria-label*="${label}" i]`),
  ];
  for (const candidate of scoped) {
    try {
      const target = candidate.first();
      if (!(await visible(target))) continue;
      await clickLocatorVisible(page, target, jarvisCursorLabel(label));
      await sleep(600);
      return true;
    } catch {
      // Try the next role/selector.
    }
  }
  return false;
}

async function hasScopedNamedControl(
  page: PlaywrightLikePage,
  scope: string,
  name: RegExp,
  roles: string[] = ["button"],
) {
  for (const role of roles) {
    try {
      const candidate = page.locator(scope).getByRole(role, { name });
      if (await visible(candidate)) return true;
    } catch {
      // Try the next role/selector.
    }
  }
  return false;
}

async function clickScopedNamedControl(
  page: PlaywrightLikePage,
  scope: string,
  name: RegExp,
  roles: string[] = ["button"],
) {
  const label = roughLabel(name);
  for (const role of roles) {
    try {
      const candidates = [
        page.locator(scope).getByRole(role, { name }),
        page.locator(scope).locator(`button:text-is("${label}")`),
        page.locator(scope).locator(`[aria-label*="${label}" i]`),
      ];
      for (const candidate of candidates) {
        const target = candidate.first();
        if (!(await visible(target))) continue;
        await clickLocatorVisible(page, target, jarvisCursorLabel(label));
        await sleep(600);
        return true;
      }
    } catch {
      // Try the next role/selector.
    }
  }
  return false;
}

async function hasNamedControl(page: PlaywrightLikePage, name: RegExp) {
  const label = roughLabel(name);
  const candidates = [
    page.getByRole("button", { name }),
    page.getByRole("link", { name }),
    page.locator("main").getByRole("button", { name }),
    page.locator("main").getByRole("link", { name }),
    page.locator(`button:text-is("${label}")`),
    page.locator(`button:has-text("${label}")`),
    page.locator(`main button:text-is("${label}")`),
    page.locator(`main a:text-is("${label}")`),
    page.locator(`[role='dialog'] button:has-text("${label}")`),
    page.locator(`.artdeco-modal button:has-text("${label}")`),
  ];
  for (const candidate of candidates) {
    if (await visible(candidate)) return true;
  }
  return false;
}

function roughLabel(name: RegExp) {
  const raw = name.source.replace(/^\^/, "").replace(/\$$/, "").replace(/\\b/g, "");
  const first = raw.split("|")[0] ?? "Message";
  return first.replace(/[()\\.?+*\[\]{}]/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * tsx/esbuild inject `__name(fn, "fn")` for keepNames. Playwright serializes
 * functions via toString() into the browser, where `__name` does not exist.
 */
export function stripTsxNameHelpers(source: string) {
  return source.replace(/__name\([A-Za-z0-9_$]+,\s*["'][^"']*["']\);?/g, "");
}

export function hydratePlaywrightFn<F extends (...args: never[]) => unknown>(fn: F): F {
  const cleaned = stripTsxNameHelpers(Function.prototype.toString.call(fn));
  // eslint-disable-next-line no-new-func -- required to drop tsx __name before CDP evaluate
  return new Function(`return (${cleaned})`)() as F;
}

async function evaluateInPage<T, A = unknown>(
  page: PlaywrightLikePage,
  fn: (arg: A) => T,
  arg?: A,
): Promise<T | null> {
  if (!page.evaluate) return null;
  try {
    return (await page.evaluate(hydratePlaywrightFn(fn as (...args: never[]) => unknown) as (arg: A) => T, arg as A)) as T;
  } catch (error) {
    if (process.env.JARVIS_DEBUG_EVAL === "1") {
      console.error("[linkedin-page.evaluate]", error instanceof Error ? error.message : error);
    }
    return null;
  }
}

async function clickEvaluatedControl(
  page: PlaywrightLikePage,
  locate: () => Promise<LinkedInDomClickHit | null>,
  press: () => Promise<LinkedInDomClickHit | null>,
) {
  if (!page.evaluate) return false;
  try {
    const hit = await locate();
    if (!hit?.ok) return false;
    if (hit.x || hit.y) {
      await moveVisibleCursor(page, hit.x, hit.y, jarvisCursorLabel(hit.label || "Click"));
      await sleep(160);
    }
    const pressed = await press();
    await sleep(280);
    return Boolean(pressed?.ok);
  } catch {
    return false;
  }
}

async function visible(locator: PlaywrightLocator | undefined) {
  if (!locator) return false;
  try {
    return await locator.first().isVisible();
  } catch {
    return false;
  }
}

/** True when `current` already is `target` (ignores hash, query-less trailing slash, case of host). */
export function isSameNavTarget(current: string, target: string) {
  const norm = (raw: string) => {
    try {
      const u = new URL(raw);
      return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    } catch {
      return null;
    }
  };
  const a = norm(current);
  const b = norm(target);
  return a !== null && a === b && !/^about:/i.test(current);
}

export function wrapPlaywrightPage(raw: unknown): LinkedInBrowserPage {
  const page = raw as PlaywrightLikePage;
  return {
    url: () => page.url(),
    title: () => page.title(),
    goto: async (url) => {
      // Already on this exact page (e.g. feed opened at connect, profile re-opened by a retry):
      // do not reload it — that is the visible "page keeps refreshing" glitch.
      if (isSameNavTarget(page.url(), url)) {
        await ensureVisibleCursor(page);
        return page.url();
      }
      // LinkedIn often never reaches networkidle; commit + short settle avoids hanging on about:blank.
      await page.goto(url, { waitUntil: "commit", timeout: 30_000 });
      await sleep(2200);
      await ensureVisibleCursor(page);
      await flashCursorStatus(page, jarvisCursorLabel("Open profile"));
      return page.url();
    },
    innerText: async () => {
      try {
        const text = await page.locator("body").first().innerText();
        return String(text ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 20000);
      } catch {
        return "";
      }
    },
    screenshot: async (path) => {
      try {
        await page.screenshot({ path, fullPage: false });
        return path;
      } catch {
        return null;
      }
    },
    hasVisibleButton: async (name) => hasNamedControl(page, name),
    clickButton: async (name) => clickNamedControl(page, name),
    hasScopedButton: async (scope, name, options) =>
      hasScopedNamedControl(page, scope, name, options?.roles ?? ["button"]),
    clickScopedButton: async (scope, name, options) =>
      clickScopedNamedControl(page, scope, name, options?.roles ?? ["button"]),
    fillPlaceholder: async (pattern, text) => {
      if (!page.getByPlaceholder) return false;
      try {
        const locator = page.getByPlaceholder(pattern).first();
        if (!(await visible(locator))) return false;
        await clickLocatorVisible(page, locator, "Type");
        await sleep(150);
        await locator.fill(text);
        return true;
      } catch {
        return false;
      }
    },
    fillSelector: async (selector, text) => {
      try {
        const locator = page.locator(selector).first();
        if (!(await visible(locator))) return false;
        await clickLocatorVisible(page, locator, "Type");
        await sleep(150);
        await locator.fill(text);
        return true;
      } catch {
        return false;
      }
    },
    clickTextContaining: async (text) => {
      try {
        const exactHandle = page.locator(`text=@${text}`).first();
        if (await visible(exactHandle)) {
          await clickLocatorVisible(page, exactHandle, "Pick person");
          await sleep(400);
          return true;
        }
      } catch {
        // fall through
      }
      if (!page.evaluate) return false;
      try {
        return await page.evaluate((needle) => {
          const nodes = Array.from(
            document.querySelectorAll("button, a, [role='option'], [role='button'], [data-testid], div"),
          );
          const hit = nodes.find((n) => {
            const t = (n.textContent || "").replace(/\s+/g, " ");
            return t.includes(`@${needle}`) || new RegExp(`(^|\\W)${needle}(\\W|$)`, "i").test(t);
          });
          if (!(hit instanceof HTMLElement)) return false;
          hit.click();
          return true;
        }, text);
      } catch {
        return false;
      }
    },
    evaluate: async (fn, arg) => evaluateInPage(page, fn as (arg: unknown) => unknown, arg as never) as never,
    fillComposer: async (text) => {
      const selectors = [
        ".msg-form__contenteditable",
        ".msg-form__contenteditable[contenteditable='true']",
        "div.msg-form__msg-content-container div[contenteditable='true']",
        ".msg-overlay-conversation-bubble div[contenteditable='true']",
        ".msg-s-message-list-container ~ form div[contenteditable='true']",
        "form.msg-form div[contenteditable='true']",
        "[aria-placeholder*='Write a message']",
        "[data-placeholder*='Write a message']",
        "div[role='textbox'][contenteditable='true']",
        "div[contenteditable='true']",
        "textarea",
      ];
      const tryFill = async (locator: PlaywrightLocator) => {
        const count = await locator.count().catch(() => 0);
        if (count < 1 && !(await visible(locator))) return false;
        try {
          await locator.scrollIntoViewIfNeeded?.();
        } catch {
          // Optional.
        }
        try {
          await clickLocatorVisible(page, locator, "Write message");
        } catch {
          try {
            await locator.click();
          } catch {
            return false;
          }
        }
        await sleep(250);
        let typed = false;
        try {
          await locator.fill(text);
          typed = true;
        } catch {
          if (!page.keyboard?.type) return false;
          await page.keyboard.type(text, { delay: 40 });
          typed = true;
        }
        if (!typed) return false;
        const seen = await locator.innerText().catch(() => "");
        const value = (await locator.getAttribute("value").catch(() => null)) ?? "";
        const blob = `${seen}\n${value}`;
        return blob.includes(text.slice(0, Math.min(24, text.length)));
      };
      for (let attempt = 0; attempt < 4; attempt += 1) {
        for (const selector of selectors) {
          try {
            if (await tryFill(page.locator(selector).first())) return true;
          } catch {
            // Try the next composer selector.
          }
        }
        if (page.getByPlaceholder) {
          try {
            if (await tryFill(page.getByPlaceholder(/write a message/i).first())) return true;
          } catch {
            // Continue.
          }
        }
        try {
          if (await tryFill(page.getByRole("textbox", { name: /message|write/i }).first())) return true;
        } catch {
          // Continue.
        }
        try {
          if (await tryFill(page.getByRole("textbox").first())) return true;
        } catch {
          // Retry after overlay animation.
        }
        await sleep(1000);
      }
      return false;
    },
    fillInvitationNote: async (text) => {
      const selectors = ["#custom-message", "textarea", 'textarea[name="message"]'];
      for (const selector of selectors) {
        try {
          const locator = page.locator(selector).first();
          if (!(await visible(locator))) continue;
          await clickLocatorVisible(page, locator, "Add note");
          await locator.fill(text);
          return true;
        } catch {
          // Try the next invitation field.
        }
      }
      return false;
    },
    collectHrefs: async (fragment) => {
      try {
        const locator = page.locator(`a[href*="${fragment}"]`);
        const count = await locator.count();
        const hrefs: string[] = [];
        for (let index = 0; index < Math.min(count, 50); index += 1) {
          const href = await locator.nth(index).getAttribute("href");
          if (href) hrefs.push(href);
        }
        return hrefs;
      } catch {
        return [];
      }
    },
    readTopCardActions: async () => {
      const detected = await evaluateInPage(page, runLinkedInTopCardCommand, {
        op: "detect",
      } satisfies LinkedInTopCardCommand);
      if (detected && typeof detected === "object" && "connect" in detected) {
        return detected as {
          connect: boolean;
          pending: boolean;
          message: boolean;
          follow: boolean;
          more: boolean;
        };
      }
      return { connect: false, pending: false, message: false, follow: false, more: false };
    },
    clickTopCardAction: async (kind) =>
      clickEvaluatedControl(
        page,
        () =>
          evaluateInPage(page, runLinkedInTopCardCommand, {
            op: "locate",
            kind,
          } satisfies LinkedInTopCardCommand) as Promise<LinkedInDomClickHit | null>,
        () =>
          evaluateInPage(page, runLinkedInTopCardCommand, {
            op: "click",
            kind,
          } satisfies LinkedInTopCardCommand) as Promise<LinkedInDomClickHit | null>,
      ),
    clickOverflowConnect: async () =>
      clickEvaluatedControl(
        page,
        () =>
          evaluateInPage(page, runLinkedInTopCardCommand, {
            op: "locate",
            kind: "overflow-connect",
          } satisfies LinkedInTopCardCommand) as Promise<LinkedInDomClickHit | null>,
        () =>
          evaluateInPage(page, runLinkedInTopCardCommand, {
            op: "click",
            kind: "overflow-connect",
          } satisfies LinkedInTopCardCommand) as Promise<LinkedInDomClickHit | null>,
      ),
    clickInviteDialogSend: async () =>
      clickEvaluatedControl(
        page,
        () =>
          evaluateInPage(page, runLinkedInTopCardCommand, {
            op: "locate",
            kind: "invite-send",
          } satisfies LinkedInTopCardCommand) as Promise<LinkedInDomClickHit | null>,
        () =>
          evaluateInPage(page, runLinkedInTopCardCommand, {
            op: "click",
            kind: "invite-send",
          } satisfies LinkedInTopCardCommand) as Promise<LinkedInDomClickHit | null>,
      ),
    findRecipientId: async () =>
      evaluateInPage(page, () => {
        const html = document.documentElement.innerHTML;
        const matches = html.match(/ACoA[A-Za-z0-9_-]{20,40}(?![A-Za-z])/g) ?? [];
        const clean = matches
          .map((value) =>
            value.replace(
              /(Topcard|SalesInsightsOrHighlights|SuggestedForYou|About|Services|Featured|SupportedLocales)$/g,
              "",
            ),
          )
          .filter((value) => /^ACoA[A-Za-z0-9_-]{20,40}$/.test(value));
        return clean[0] ?? matches[0]?.slice(0, 39) ?? null;
      }),
    wait: (ms) => sleep(ms),
  };
}

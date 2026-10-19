/**
 * On-screen pointer so the operator can see Jarvis move, click, type, and send —
 * not just page navigations.
 */
export const JARVIS_CURSOR_ID = "jarvis-visible-cursor";
export const JARVIS_CURSOR_LABEL_ID = "jarvis-visible-cursor-label";

type CursorPage = {
  mouse?: { move: (x: number, y: number, opts?: { steps?: number }) => Promise<unknown> };
  evaluate?: <T, A = unknown>(fn: (arg: A) => T, arg?: A) => Promise<T | null>;
};

type CursorLocator = {
  click: (opts?: { force?: boolean }) => Promise<void>;
  scrollIntoViewIfNeeded?: () => Promise<void>;
  boundingBox?: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
};

const POS_KEY = "jarvis.cursor.pos";

/**
 * Registered once via context.addInitScript so the overlay exists on every document
 * (hard navigations, new frames) before any action runs, and is re-attached if a SPA
 * re-render removes it. Plain string on purpose: no tsx __name helpers inside the page.
 */
export const JARVIS_CURSOR_INIT_SCRIPT = `(() => {
  if (window.top !== window || window.__jarvisCursorInit) return;
  window.__jarvisCursorInit = true;
  var KEY = ${JSON.stringify(POS_KEY)};
  function pos() {
    try {
      var p = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (p && isFinite(p.x) && isFinite(p.y)) return { x: Math.max(12, p.x), y: Math.max(12, p.y) };
    } catch (e) {}
    return { x: 72, y: 120 };
  }
  function mount() {
    var root = document.documentElement;
    if (!root) return;
    var p = pos();
    var shared = "position:fixed;z-index:2147483647;pointer-events:none;transition:none;";
    var c = document.getElementById(${JSON.stringify(JARVIS_CURSOR_ID)});
    if (!c) {
      c = document.createElement("div");
      c.id = ${JSON.stringify(JARVIS_CURSOR_ID)};
      c.setAttribute("aria-hidden", "true");
      c.dataset.x = String(p.x);
      c.dataset.y = String(p.y);
      c.style.cssText = shared + "width:22px;height:22px;margin-left:-4px;margin-top:-4px;border:3px solid #16a34a;border-radius:50%;background:rgba(22,163,74,0.45);box-shadow:0 0 14px rgba(22,163,74,0.6);left:" + p.x + "px;top:" + p.y + "px";
      root.appendChild(c);
    }
    var l = document.getElementById(${JSON.stringify(JARVIS_CURSOR_LABEL_ID)});
    if (!l) {
      l = document.createElement("div");
      l.id = ${JSON.stringify(JARVIS_CURSOR_LABEL_ID)};
      l.setAttribute("aria-hidden", "true");
      l.textContent = "Jarvis";
      l.style.cssText = shared + "background:#14532d;color:#ecfdf5;font:12px/1.2 ui-sans-serif,system-ui,sans-serif;padding:3px 8px;border-radius:4px;left:" + (p.x + 18) + "px;top:" + (p.y + 22) + "px";
      root.appendChild(l);
    }
  }
  mount();
  document.addEventListener("DOMContentLoaded", mount);
  var mo = new MutationObserver(function () {
    if (!document.getElementById(${JSON.stringify(JARVIS_CURSOR_ID)}) || !document.getElementById(${JSON.stringify(JARVIS_CURSOR_LABEL_ID)})) mount();
  });
  function watch() {
    // The overlay lives directly under <html>, so that is the node whose children must be watched.
    if (document.documentElement) mo.observe(document.documentElement, { childList: true });
  }
  watch();
  document.addEventListener("DOMContentLoaded", watch);
  window.addEventListener("pageshow", mount);
})();`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Inject or reattach the green cursor. Position survives navigations via sessionStorage. */
export async function ensureVisibleCursor(page: CursorPage) {
  if (!page.evaluate) return;
  // Cosmetic: a navigation racing the overlay must never fail the real action.
  await ensureVisibleCursorUnsafe(page).catch(() => undefined);
}

async function ensureVisibleCursorUnsafe(page: CursorPage) {
  if (!page.evaluate) return;
  await page.evaluate((storageKey) => {
    const cursorId = "jarvis-visible-cursor";
    const labelId = "jarvis-visible-cursor-label";
    // Already mounted (init script or earlier call): do not rebuild/reset position.
    if (document.getElementById(cursorId) && document.getElementById(labelId)) return;
    let x = 72;
    let y = 120;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { x?: number; y?: number };
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          x = Math.max(12, Number(parsed.x));
          y = Math.max(12, Number(parsed.y));
        }
      }
    } catch {
      // ignore
    }
    const shared = [
      "position:fixed",
      "z-index:2147483647",
      "pointer-events:none",
      "will-change:transform,left,top",
      "transition:none",
    ].join(";");

    let cursor = document.getElementById(cursorId);
    if (!cursor) {
      cursor = document.createElement("div");
      cursor.id = cursorId;
      cursor.setAttribute("aria-hidden", "true");
      document.documentElement.appendChild(cursor);
    }
    cursor.dataset.x = String(x);
    cursor.dataset.y = String(y);
    cursor.style.cssText = [
      shared,
      "width:22px",
      "height:22px",
      "margin-left:-4px",
      "margin-top:-4px",
      "border:3px solid #16a34a",
      "border-radius:50%",
      "background:rgba(22,163,74,0.45)",
      "box-shadow:0 0 14px rgba(22,163,74,0.6)",
      `left:${x}px`,
      `top:${y}px`,
      "transform:translate3d(0,0,0)",
    ].join(";");

    let label = document.getElementById(labelId);
    if (!label) {
      label = document.createElement("div");
      label.id = labelId;
      label.setAttribute("aria-hidden", "true");
      document.documentElement.appendChild(label);
    }
    if (!label.textContent) label.textContent = "Jarvis";
    label.style.cssText = [
      shared,
      "background:#14532d",
      "color:#ecfdf5",
      "font:12px/1.2 ui-sans-serif,system-ui,sans-serif",
      "padding:3px 8px",
      "border-radius:4px",
      `left:${x + 18}px`,
      `top:${y + 22}px`,
    ].join(";");
  }, POS_KEY);
}

export async function moveVisibleCursor(page: CursorPage, x: number, y: number, label?: string) {
  await ensureVisibleCursor(page);
  const targetX = Math.max(8, x);
  const targetY = Math.max(8, y);

  if (!page.evaluate) {
    if (page.mouse?.move) await page.mouse.move(targetX, targetY, { steps: 24 });
    return;
  }

  const from = await page.evaluate((storageKey) => {
    const cursor = document.getElementById("jarvis-visible-cursor");
    let x0 = Number(cursor?.dataset.x ?? 72);
    let y0 = Number(cursor?.dataset.y ?? 120);
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { x?: number; y?: number };
        if (Number.isFinite(parsed.x)) x0 = Number(parsed.x);
        if (Number.isFinite(parsed.y)) y0 = Number(parsed.y);
      }
    } catch {
      // ignore
    }
    return {
      x: Number.isFinite(x0) ? x0 : 72,
      y: Number.isFinite(y0) ? y0 : 120,
    };
  }, POS_KEY).catch(() => null);
  if (!from) {
    if (page.mouse?.move) await page.mouse.move(targetX, targetY, { steps: 12 }).catch(() => undefined);
    return;
  }

  const dist = Math.hypot(targetX - from.x, targetY - from.y);
  const duration = Math.min(900, Math.max(220, Math.round(180 + dist * 0.9)));
  const frames = Math.max(12, Math.round(duration / 16));
  // Curved path (quadratic bezier with a small perpendicular bow) + minimum-jerk easing,
  // so the pointer accelerates, glides, and decelerates like a human hand.
  const bow = Math.min(60, dist * 0.12) * (Math.random() < 0.5 ? -1 : 1);
  const mx = (from.x + targetX) / 2 + (-(targetY - from.y) / (dist || 1)) * bow;
  const my = (from.y + targetY) / 2 + ((targetX - from.x) / (dist || 1)) * bow;
  const ease = (t: number) => t * t * t * (t * (6 * t - 15) + 10);

  // Drop CSS transitions: each frame sets the exact position, so overlay == real pointer.
  await page.evaluate(
    (input) => {
      const cursor = document.getElementById("jarvis-visible-cursor");
      const cap = document.getElementById("jarvis-visible-cursor-label");
      for (const el of [cursor, cap]) if (el) el.style.transition = "none";
      if (cap && input.label) cap.textContent = input.label;
    },
    { label: label ?? "Jarvis" },
  );

  const started = Date.now();
  for (let i = 1; i <= frames; i += 1) {
    const e = ease(i / frames);
    const u = 1 - e;
    const px = u * u * from.x + 2 * u * e * mx + e * e * targetX;
    const py = u * u * from.y + 2 * u * e * my + e * e * targetY;
    if (page.mouse?.move) await page.mouse.move(px, py);
    const painted = await page.evaluate(
      (input) => {
        const cursor = document.getElementById("jarvis-visible-cursor");
        const cap = document.getElementById("jarvis-visible-cursor-label");
        if (cursor) {
          cursor.style.left = `${input.x}px`;
          cursor.style.top = `${input.y}px`;
          cursor.dataset.x = String(input.x);
          cursor.dataset.y = String(input.y);
        }
        if (cap) {
          cap.style.left = `${input.x + 18}px`;
          cap.style.top = `${input.y + 22}px`;
        }
        try {
          sessionStorage.setItem(input.storageKey, JSON.stringify({ x: input.x, y: input.y }));
        } catch {
          // ignore
        }
      },
      { x: px, y: py, storageKey: POS_KEY },
    ).then(
      () => true,
      () => false,
    );
    // Page navigated mid-glide: the overlay is gone, finish the real pointer move and stop.
    if (!painted) {
      if (page.mouse?.move) await page.mouse.move(targetX, targetY).catch(() => undefined);
      return;
    }
    const wait = started + Math.round((i / frames) * duration) - Date.now();
    if (wait > 0) await sleep(wait);
  }
  await sleep(40);
}

/** Show skip/fail status on the cursor so page flips are not silent. */
export async function flashCursorStatus(page: CursorPage, label: string) {
  await ensureVisibleCursor(page);
  if (!page.evaluate) return;
  try {
    await page.evaluate((text) => {
      const cap = document.getElementById("jarvis-visible-cursor-label");
      if (cap) cap.textContent = text.slice(0, 36);
    }, label);
  } catch {
    return;
  }
  await sleep(450);
}

export async function clickLocatorVisible(page: CursorPage, locator: CursorLocator, label = "Click") {
  try {
    await locator.scrollIntoViewIfNeeded?.();
  } catch {
    // Optional.
  }
  const box = await locator.boundingBox?.().catch(() => null);
  if (box) {
    await moveVisibleCursor(page, box.x + box.width / 2, box.y + box.height / 2, label);
    if (page.evaluate) {
      await page.evaluate(() => {
        const cursor = document.getElementById("jarvis-visible-cursor");
        if (!cursor) return;
        cursor.style.transform = "scale(0.85)";
        window.setTimeout(() => {
          cursor.style.transform = "scale(1)";
        }, 110);
      });
    }
    await sleep(70);
  } else {
    await ensureVisibleCursor(page);
  }
  try {
    await locator.click();
  } catch {
    await locator.click({ force: true });
  }
  await sleep(200);
}

export function jarvisCursorLabel(action: string) {
  return action.replace(/\s+/g, " ").trim().slice(0, 28) || "Jarvis";
}

/** Short status for the on-screen label (skips / outcomes). */
export function jarvisCursorStatus(action: string) {
  return action.replace(/\s+/g, " ").trim().slice(0, 36) || "Jarvis";
}

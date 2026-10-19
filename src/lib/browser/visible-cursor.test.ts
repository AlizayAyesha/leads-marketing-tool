import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hydratePlaywrightFn, isSameNavTarget, stripTsxNameHelpers } from "./linkedin-page";
import { jarvisPlaywrightLaunchOptions } from "./jarvis-chrome-launch";
import { JARVIS_CURSOR_INIT_SCRIPT, jarvisCursorLabel, jarvisCursorStatus } from "./visible-cursor";

describe("visible send cursor", () => {
  it("keeps the on-screen label short so the operator can read the action", () => {
    assert.equal(jarvisCursorLabel("Send"), "Send");
    assert.equal(jarvisCursorLabel("  Click Message  "), "Click Message");
    assert.ok(jarvisCursorLabel("A".repeat(80)).length <= 28);
  });

  it("keeps skip/status flashes readable on the cursor badge", () => {
    assert.equal(jarvisCursorStatus("Skip — already connected"), "Skip — already connected");
    assert.ok(jarvisCursorStatus("A".repeat(80)).length <= 36);
  });
});

describe("Playwright evaluate hydration", () => {
  it("strips tsx/esbuild __name helpers so browser evaluate can run", () => {
    const poisoned = `function demo(input){function inner(){return 1}__name(inner,"inner");return inner()+input}`;
    const cleaned = stripTsxNameHelpers(poisoned);
    assert.equal(cleaned.includes("__name"), false);
    const fn = hydratePlaywrightFn(new Function(`return (${cleaned})`)() as (n: number) => number);
    assert.equal(fn(2), 3);
  });
});

describe("stable browser window", () => {
  it("uses no viewport emulation and a fixed window size set once", () => {
    const opts = jarvisPlaywrightLaunchOptions("/tmp/x");
    assert.equal(opts.viewport, null);
    assert.ok(opts.args.some((a) => /^--window-size=\d+,\d+$/.test(a)));
    assert.equal(opts.slowMo, 0);
  });

  it("skips re-navigation to the page already open", () => {
    assert.equal(isSameNavTarget("https://www.linkedin.com/in/foo/", "https://www.linkedin.com/in/foo"), true);
    assert.equal(isSameNavTarget("https://www.linkedin.com/in/foo/#x", "https://www.linkedin.com/in/foo/"), true);
    assert.equal(isSameNavTarget("https://www.linkedin.com/in/foo/", "https://www.linkedin.com/in/bar/"), false);
    assert.equal(isSameNavTarget("about:blank", "about:blank"), false);
  });

  it("ships a syntactically valid persistent overlay init script", () => {
    assert.doesNotThrow(() => new Function(JARVIS_CURSOR_INIT_SCRIPT));
    assert.ok(JARVIS_CURSOR_INIT_SCRIPT.includes("jarvis-visible-cursor"));
    assert.ok(!JARVIS_CURSOR_INIT_SCRIPT.includes("__name"));
  });
});

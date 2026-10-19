/** Self-contained: Playwright evaluate() only serializes this function, not module helpers. */

export type LinkedInTopCardActions = {
  connect: boolean;
  pending: boolean;
  message: boolean;
  follow: boolean;
  more: boolean;
};

export type LinkedInDomClickHit = {
  ok: boolean;
  x: number;
  y: number;
  label: string;
};

export type LinkedInTopCardCommand =
  | { op: "detect" }
  | { op: "locate" | "click"; kind: "connect" | "more" | "message" | "overflow-connect" | "invite-send" };

export function runLinkedInTopCardCommand(input: LinkedInTopCardCommand): LinkedInTopCardActions | LinkedInDomClickHit {
  function visibleBox(el: Element) {
    const node = el as HTMLElement;
    const r = node.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return null;
    const style = window.getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return null;
    return r;
  }

  function controlLabel(el: Element) {
    const node = el as HTMLElement;
    return `${node.getAttribute("aria-label") || ""} ${(node.innerText || node.textContent || "").replace(/\s+/g, " ")}`.trim();
  }

  function findByLabel(nodes: Element[], pattern: RegExp, reject?: RegExp) {
    return (
      nodes.find((el) => {
        const label = controlLabel(el);
        if (!pattern.test(label)) return false;
        if (reject?.test(label)) return false;
        return true;
      }) ?? null
    );
  }

  function inSidebar(el: Element) {
    return Boolean(el.closest("aside, .scaffold-layout__aside, .pv-profile-sticky-sidebar"));
  }

  function inRecommendationRegion(el: Element) {
    if (
      el.closest(
        ".pv-browsemap-section, .pvs-browsemap, [data-view-name*='browsemap' i], [data-view-name*='recommendation' i], [data-view-name*='similar' i]",
      )
    ) {
      return true;
    }
    const section = el.closest("section");
    const title = (section?.querySelector("h2, h3")?.textContent || "").toLowerCase();
    return /people similar|people also|explore premium|you might know|more profiles for you|people you may know/i.test(
      title,
    );
  }

  function headerControls() {
    const main = document.querySelector("main") || document.body;
    const heading =
      main.querySelector("section h1") ||
      main.querySelector("h1") ||
      main.querySelector(".text-heading-xlarge");
    const headingBox = heading ? heading.getBoundingClientRect() : null;
    const nodes = Array.from(main.querySelectorAll("button, a, [role='button']"));
    return nodes.filter((el) => {
      if (inSidebar(el) || inRecommendationRegion(el)) return false;
      const box = visibleBox(el);
      if (!box) return false;
      if (headingBox) {
        // Primary profile actions sit on the same card as the name (not “People similar”).
        if (box.top < headingBox.top - 40) return false;
        if (box.top > headingBox.bottom + 260) return false;
        return true;
      }
      return box.top < 520;
    });
  }

  function locateElement(el: Element, label: string): LinkedInDomClickHit {
    const node = el as HTMLElement;
    node.scrollIntoView({ block: "center", inline: "center" });
    const box = visibleBox(node) ?? node.getBoundingClientRect();
    return {
      ok: true,
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      label,
    };
  }

  function clickElement(el: Element, label: string): LinkedInDomClickHit {
    const located = locateElement(el, label);
    (el as HTMLElement).click();
    return located;
  }

  function connectIn(nodes: Element[]) {
    return (
      findByLabel(nodes, /invite .+\s+to connect/i) ||
      findByLabel(nodes, /(^|\s)connect(\s|$)/i, /disconnect|remove connection/i)
    );
  }

  function moreIn(nodes: Element[]) {
    return findByLabel(nodes, /more actions/i) || findByLabel(nodes, /(^|\s)more(\s|$)/i);
  }

  function overflowConnect() {
    const nodes = Array.from(
      document.querySelectorAll(
        "[role='menuitem'], [role='menu'] button, [role='menu'] [role='button'], .artdeco-dropdown__item, .artdeco-dropdown__content button, .artdeco-dropdown__content [role='button']",
      ),
    );
    return findByLabel(nodes, /\bconnect\b|invite .+\s+to connect/i, /disconnect|remove connection/i);
  }

  function isInviteDialog(el: Element) {
    const text = ((el as HTMLElement).innerText || el.textContent || "").toLowerCase();
    if (/copy link to post|send .+['’]?s post|share via/i.test(text)) return false;
    return /add a note to your invitation|send without a note|send invitation|how do you know|personalize your invitation/i.test(
      text,
    );
  }

  function inviteRoots() {
    const nodes = Array.from(
      document.querySelectorAll(
        "[role='dialog'], .artdeco-modal, .artdeco-modal__content, div.send-invite, .send-invite__actions",
      ),
    );
    const matched = nodes.filter(isInviteDialog);
    if (matched.length) return matched;
    // Fallback: button label alone (LinkedIn sometimes omits role=dialog).
    const sendWithout = Array.from(document.querySelectorAll("button, [role='button']")).find((el) =>
      /send without a note/i.test(controlLabel(el)),
    );
    if (sendWithout) {
      const root =
        sendWithout.closest("[role='dialog'], .artdeco-modal, .artdeco-modal__content, div.send-invite") ||
        sendWithout.parentElement;
      return root ? [root] : [];
    }
    return [];
  }

  function inviteSend() {
    for (const dialog of inviteRoots()) {
      const nodes = Array.from(dialog.querySelectorAll("button, [role='button']"));
      const hit =
        findByLabel(nodes, /send without a note/i) ||
        findByLabel(nodes, /^send invitation$/i) ||
        findByLabel(nodes, /^send now$/i) ||
        findByLabel(nodes, /(^|\s)send(\s|$)/i, /don't send|cancel|send .+post|copy link|add a note/i);
      if (hit) return hit;
    }
    // Last resort: any visible "Send without a note" on the page.
    return (
      findByLabel(
        Array.from(document.querySelectorAll("button, [role='button']")),
        /send without a note/i,
      ) || null
    );
  }

  function resolveTarget() {
    if (input.op === "detect") return null;
    if (input.kind === "connect") return connectIn(headerControls());
    if (input.kind === "more") return moreIn(headerControls());
    if (input.kind === "message") return findByLabel(headerControls(), /(^|\s)message(\s|$)/i);
    if (input.kind === "overflow-connect") return overflowConnect();
    return inviteSend();
  }

  if (input.op === "detect") {
    const nodes = headerControls();
    return {
      connect: Boolean(connectIn(nodes)),
      pending: Boolean(findByLabel(nodes, /(^|\s)pending(\s|$)/i)),
      message: Boolean(findByLabel(nodes, /(^|\s)message(\s|$)/i)),
      follow: Boolean(findByLabel(nodes, /(^|\s)follow(\s|$)/i, /following|unfollow/i)),
      more: Boolean(moreIn(nodes)),
    };
  }

  const el = resolveTarget();
  const label =
    input.kind === "more" ? "More" : input.kind === "message" ? "Message" : input.kind === "invite-send" ? "Send" : "Connect";
  if (!el) return { ok: false, x: 0, y: 0, label };
  return input.op === "click" ? clickElement(el, label) : locateElement(el, label);
}

function encodeSubject(subject: string) {
  return /[^\x00-\x7f]/.test(subject) ? `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=` : subject;
}

function bareAddress(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(raw)?.[1];
  const candidate = angle ?? raw;
  return /^[^\s<>@,;]+@[^\s<>@,;]+$/.test(candidate) ? candidate : null;
}

/** RFC 2369 List-Unsubscribe + RFC 8058 one-click (the latter only when an https URL exists). */
export function listUnsubscribeHeaders(input: {
  unsubscribe?: { mailto?: string | null; url?: string | null } | null;
  replyTo?: string | null;
  from: string;
}) {
  const targets: string[] = [];
  const mailto = bareAddress(input.unsubscribe?.mailto) ?? bareAddress(input.replyTo) ?? bareAddress(input.from);
  if (mailto) targets.push(`<mailto:${mailto}?subject=unsubscribe>`);
  const url = input.unsubscribe?.url?.trim();
  if (url && /^https:\/\/[^\s<>]+$/i.test(url)) targets.push(`<${url}>`);
  if (!targets.length) return null;
  const out = [`List-Unsubscribe: ${targets.join(", ")}`];
  if (url && /^https:\/\//i.test(url)) out.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  return out;
}

/**
 * Compliance footer (on by default): sender identity + postal address + how to unsubscribe.
 * CAN-SPAM / GDPR / PECR-style rules generally require these in cold email.
 * Set EMAIL_COMPLIANCE_FOOTER=false only if your template already includes them.
 */
export function complianceFooter(env: Record<string, string | undefined> = process.env) {
  if ((env.EMAIL_COMPLIANCE_FOOTER ?? "").trim().toLowerCase() === "false") return null;
  const name = (env.OUTREACH_FROM_NAME ?? "").trim();
  const address = (env.OUTREACH_SENDER_ADDRESS ?? "").trim();
  const identity = [name, address].filter(Boolean).join(" · ");
  const unsub = 'Not interested? Reply "unsubscribe" and you will not hear from us again.';
  return identity ? `${identity}\n${unsub}` : unsub;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function withFooter(body: string, html: string | null | undefined) {
  const footer = complianceFooter();
  if (!footer || /unsubscribe/i.test(body)) return { body, html };
  const text = `${body.trimEnd()}\n\n--\n${footer}`;
  let outHtml = html;
  if (html?.trim()) {
    const block = `<p style="font-size:12px;color:#888;margin-top:24px;">${escapeHtml(footer).replace(/\n/g, "<br/>")}</p>`;
    outHtml = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${block}</body>`) : `${html}${block}`;
  }
  return { body: text, html: outHtml };
}

/** Build a Gmail API-ready base64url RFC822 payload (plain or multipart/alternative). */
export function rfc822({
  to,
  from,
  subject,
  body,
  html,
  replyTo,
  unsubscribe,
}: {
  to: string;
  from: string;
  subject: string;
  body: string;
  html?: string | null;
  replyTo?: string | null;
  /** mailto: and/or https: unsubscribe targets. Defaults to a mailto: to the Reply-To/From address. */
  unsubscribe?: { mailto?: string | null; url?: string | null } | null;
}) {
  ({ body, html } = withFooter(body, html));
  const headers = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
  ];
  if (replyTo?.trim()) headers.push(`Reply-To: ${replyTo.trim()}`);
  const unsub = listUnsubscribeHeaders({ unsubscribe, replyTo, from });
  if (unsub) headers.push(...unsub);

  if (html?.trim()) {
    const boundary = `lmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const raw = [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      html,
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    return Buffer.from(raw).toString("base64url");
  }

  const raw = [...headers, "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

import { getBusinessProfile } from "@/lib/business/profile";
import {
  BRAND_BOOK_URL,
  BRAND_EMAIL_COLORS as C,
  BRAND_SITE_URL,
} from "@/lib/outreach/email-brand";

export type ColdEmailCardInput = {
  /** Plain-text body from the outreach draft (paragraphs separated by blank lines). */
  message: string;
  recipientName?: string | null;
  company?: string | null;
  ctaUrl?: string | null;
  ctaLabel?: string | null;
  previewText?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphsToHtml(message: string) {
  const blocks = message
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!blocks.length) {
    return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${C.text};">Hello,</p>`;
  }
  return blocks
    .map((block) => {
      const lines = escapeHtml(block).replace(/\n/g, "<br />");
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${C.text};">${lines}</p>`;
    })
    .join("\n");
}

/**
 * Premium HTML card for cold email — dark + green theme.
 * Keeps layout table-based for Gmail/Outlook compatibility.
 */
export function buildColdEmailHtml(input: ColdEmailCardInput) {
  const ctaUrl = input.ctaUrl?.trim() || BRAND_BOOK_URL;
  const ctaLabel = input.ctaLabel?.trim() || "Book a discovery call";
  const preview = escapeHtml(
    input.previewText?.trim() ||
      "Technology partner for operators who need revenue-linked outcomes — your business.",
  );
  const bodyHtml = paragraphsToHtml(input.message);
  const companyLine = input.company?.trim()
    ? `<p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};">${escapeHtml(input.company.trim())}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>your business</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preview}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${C.card};border:1px solid ${C.cardBorder};border-radius:18px;overflow:hidden;">
          <tr>
            <td style="height:4px;background:linear-gradient(90deg, ${C.accent} 0%, ${C.gold} 100%);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${C.white};">your business</p>
                    <p style="margin:0;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${C.accentMuted};">Custom software · AI automation</p>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    ${companyLine}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 8px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px 28px;" align="left">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-radius:999px;background:${C.accent};">
                    <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${C.bg};text-decoration:none;">${escapeHtml(ctaLabel)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:18px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${C.muted};">
                Technology partner for operators who need revenue-linked outcomes — not another vendor deck.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px 28px;border-top:1px solid ${C.cardBorder};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
              <p style="margin:0 0 6px;font-size:12px;color:${C.muted};">
                <a href="${BRAND_SITE_URL}" style="color:${C.accentSoft};text-decoration:none;">${BRAND_SITE_URL.replace(/^https?:\/\//, "")}</a>
              </p>
              <p style="margin:0;font-size:11px;color:${C.muted};">
                You’re receiving this because we believe there may be a fit with your team. Reply to this email to continue the conversation, or ignore if not relevant.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text fallback that mirrors the card CTA. */
export function buildColdEmailText(input: ColdEmailCardInput) {
  const ctaUrl = input.ctaUrl?.trim() || BRAND_BOOK_URL;
  const ctaLabel = input.ctaLabel?.trim() || "Book a discovery call";
  const body = input.message.replace(/\r\n/g, "\n").trim();
  return `${body}

—
${ctaLabel}: ${ctaUrl}
${getBusinessProfile().businessName} · ${BRAND_SITE_URL}`;
}

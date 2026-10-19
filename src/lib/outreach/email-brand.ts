/** Cold-outreach email brand. Name / site come from your Business Profile. */
import { getBusinessProfile } from "@/lib/business/profile";

export const BRAND_SITE_URL = getBusinessProfile().website;
export const BRAND_BOOK_URL = `${(process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "")}/go/website`;
export const BRAND_OUTREACH_FROM_NAME = getBusinessProfile().businessName;

export const BRAND_EMAIL_COLORS = {
  bg: "#010101",
  card: "#0a140c",
  cardBorder: "#1a3a28",
  accent: "#22c55e",
  accentSoft: "#4ade80",
  accentMuted: "#86efac",
  text: "#f4f6f5",
  muted: "#a1a1aa",
  gold: "#d4af37",
  white: "#ffffff",
} as const;

/**
 * From address for Gmail sends.
 * Default: connected Google account email (no sales@ alias required).
 * Optional override: OUTREACH_FROM_EMAIL / OUTREACH_FROM_NAME.
 */
export function resolveOutreachFromAddress(input?: {
  envFrom?: string | null;
  envName?: string | null;
  connectedEmail?: string | null;
}) {
  const connected = (input?.connectedEmail ?? "").trim();
  const email =
    (input?.envFrom ?? process.env.OUTREACH_FROM_EMAIL ?? "").trim() || connected || "me";
  const name =
    (input?.envName ?? process.env.OUTREACH_FROM_NAME ?? "").trim() || BRAND_OUTREACH_FROM_NAME;
  return {
    email,
    name,
    header: email.includes("<") ? email : `${name} <${email}>`,
    connectedHint: connected || null,
  };
}

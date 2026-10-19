import { getBusinessProfile } from "@/lib/business/profile";
import { classifyBuyerRole } from "@/lib/outreach/buyer-icp";
import { qualifyCommercial } from "@/lib/intelligence/commercial";
import { describePitch } from "@/lib/intelligence/offers";
import {
  ELITE_ECOSYSTEMS,
  type EliteEcosystemId,
  type EliteSignalId,
} from "@/lib/elite/catalog";

export type EliteSignalHit = {
  id: EliteSignalId;
  label: string;
  icon: string;
  present: boolean;
  evidence: string;
};

const SIGNAL_DEFS: Array<{ id: EliteSignalId; label: string; icon: string; re: RegExp }> = [
  { id: "private_aviation", label: "Private Aviation", icon: "✈️", re: /\b(private jet|business jet|air charter|private aviation|fbo\b|jet charter)\b/i },
  { id: "superyacht", label: "Superyacht", icon: "🛥️", re: /\b(superyacht|yacht (broker|charter|management)|motor yacht)\b/i },
  { id: "luxury_real_estate", label: "Luxury Real Estate", icon: "🏙️", re: /\b(luxury (real estate|property|villa)|high[- ]end (property|real estate)|penthouse|off[- ]plan)\b/i },
  { id: "family_office", label: "Family Office", icon: "💼", re: /\bfamily office|multi[- ]family office\b/i },
  { id: "luxury_hospitality", label: "Luxury Hospitality", icon: "🏨", re: /\b(luxury hotel|five[- ]star|5[- ]star|palace hotel|members? club|resort)\b/i },
  { id: "investment", label: "Investment", icon: "📈", re: /\b(private equity|asset management|investment (company|firm|office)|hedge fund)\b/i },
  { id: "premium_healthcare", label: "Premium Healthcare", icon: "🏥", re: /\b(private clinic|executive health|aesthetic clinic|premium healthcare|medspa)\b/i },
  { id: "luxury_automotive", label: "Luxury Automotive", icon: "🚘", re: /\b(exotic car|supercar|luxury automotive|ferrari|lamborghini dealer)\b/i },
  { id: "luxury_retail", label: "Luxury Retail", icon: "💎", re: /\b(haute joaillerie|luxury retail|designer boutique)\b/i },
  { id: "international", label: "International", icon: "🌎", re: /\b(dubai|monaco|milan|doha|riyadh|miami|london|singapore|international|multi[- ]country)\b/i },
  { id: "technology_gap", label: "Technology Gap", icon: "⚠️", re: /\b(whatsapp (only|inquir)|no (online )?booking|outdated website|contact form only|manual (process|follow)|spreadsheet)\b/i },
  { id: "growth", label: "Growth Signal", icon: "📈", re: /\b(expansion|new (office|location|fleet|development)|hiring|launch)\b/i },
];

export function eliteHaystack(input: {
  company?: string | null;
  industry?: string | null;
  location?: string | null;
  notes?: string | null;
  originalPost?: string | null;
  website?: string | null;
  roleTitle?: string | null;
}) {
  return [input.company, input.industry, input.location, input.notes, input.originalPost, input.website, input.roleTitle]
    .filter(Boolean)
    .join(" ");
}

export function detectEliteSignals(input: Parameters<typeof eliteHaystack>[0]): EliteSignalHit[] {
  const hay = eliteHaystack(input);
  return SIGNAL_DEFS.map((def) => {
    const match = hay.match(def.re);
    return {
      id: def.id,
      label: def.label,
      icon: def.icon,
      present: Boolean(match),
      evidence: match ? `Matched “${match[0]}”.` : "Not observed in stored fields.",
    };
  });
}

export function eliteNarrative(
  input: Parameters<typeof eliteHaystack>[0] & {
    signals?: EliteSignalHit[];
    pitch?: string | null;
  },
) {
  const hits = (input.signals ?? detectEliteSignals(input)).filter((item) => item.present);
  const markets = hits.filter((item) =>
    ["private_aviation", "superyacht", "luxury_real_estate", "family_office", "luxury_hospitality", "investment", "premium_healthcare", "luxury_automotive", "luxury_retail"].includes(item.id),
  );
  const gap = hits.find((item) => item.id === "technology_gap");
  if (!markets.length) {
    return "Not enough evidence of a high-value market. Do not treat this as an elite prospect.";
  }
  const names = markets.map((item) => item.label.toLowerCase()).join(", ");
  const need = gap
    ? " Observed operations still look manual or under-tooled."
    : " Confirm the technology gap from the public site before pitching.";
  const pitch = input.pitch ? ` ${input.pitch}` : " Match a ${getBusinessProfile().businessName} offer (web, automation, architecture, graphics, or AI ads/UGC) from evidence — do not default to “they are rich.”";
  return `This company operates in a high-value market (${names}).${need}${pitch} This is not a wealth-of-person claim.`;
}

export function eliteScoreBand(total: number) {
  if (total >= 80) return { code: "priority" as const, label: "Priority" };
  if (total >= 60) return { code: "qualified" as const, label: "Qualified" };
  if (total >= 40) return { code: "review" as const, label: "Review" };
  return { code: "reject" as const, label: "Reject" };
}

export function scoreEliteProspect(input: Parameters<typeof eliteHaystack>[0] & { email?: string | null; linkedinUrl?: string | null }) {
  const signals = detectEliteSignals(input);
  const commercial = qualifyCommercial({
    company: input.company,
    industry: input.industry,
    location: input.location,
    website: input.website,
    email: input.email,
    linkedinUrl: input.linkedinUrl,
    roleTitle: input.roleTitle,
    notes: input.notes,
    originalPost: input.originalPost,
    highTicket: signals.some((item) => item.present && item.id !== "international" && item.id !== "growth"),
  });
  const buyer = classifyBuyerRole(input.roleTitle, input.company ?? input.industry);
  const marketHits = signals.filter((item) => item.present && !["international", "technology_gap", "growth"].includes(item.id)).length;
  let total = commercial.total;
  if (marketHits >= 1) total += 4;
  if (signals.find((item) => item.id === "technology_gap")?.present) total += 6;
  if (signals.find((item) => item.id === "growth")?.present) total += 3;
  if (input.location && /dubai|monaco|milan|doha|riyadh|miami|london|singapore/i.test(input.location)) total += 2;
  total = Math.max(0, Math.min(100, Math.round(total)));
  const band = eliteScoreBand(total);
  const pitch = describePitch(commercial.offer);
  return {
    total,
    band,
    commercial,
    buyer,
    signals,
    pitch,
    offer: commercial.offer,
    narrative: eliteNarrative({ ...input, signals, pitch }),
    rejected: band.code === "reject" || commercial.rejected,
  };
}

export function ecosystemLabel(id: EliteEcosystemId) {
  return ELITE_ECOSYSTEMS.find((item) => item.id === id)?.label ?? id;
}

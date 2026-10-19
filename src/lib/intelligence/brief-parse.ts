import type { CommercialBrief } from "@/lib/intelligence/commercial";

export function parseStoredCommercialBrief(value: unknown): CommercialBrief | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.commercial && typeof row.commercial === "object") return row.commercial as CommercialBrief;
  if (typeof row.buyNowScore === "number" && "selection" in row) return row as unknown as CommercialBrief;
  return null;
}

export function parseBriefFromEvidenceItems(items: unknown): CommercialBrief | null {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const text = "text" in item ? String((item as { text?: unknown }).text ?? "") : "";
    if (!text.includes("commercialBrief")) continue;
    try {
      const parsed = JSON.parse(text) as { commercialBrief?: CommercialBrief };
      if (parsed.commercialBrief) return parsed.commercialBrief;
    } catch {
      continue;
    }
  }
  return null;
}

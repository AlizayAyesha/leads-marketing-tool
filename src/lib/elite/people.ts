import { ELITE_TARGET_ROLES } from "@/lib/elite/catalog";

const ROLE_RE =
  /\b(founder|co-?founder|chief executive|ceo|managing director|owner|proprietor|partner|chief technology officer|cto|chief marketing officer|cmo|head of digital|director of operations|coo)\b/i;

export type ExtractedPerson = {
  name: string | null;
  role: string;
  evidence: string;
};

export function extractDecisionMakersFromText(text: string, limit = 5): ExtractedPerson[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: ExtractedPerson[] = [];
  const seen = new Set<string>();
  const pattern =
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s*[,|–—-]?\s*((?:Founder|Co-Founder|Chief Executive Officer|CEO|Managing Director|Owner|Partner|Chief Technology Officer|CTO|Chief Marketing Officer|CMO|Head of Digital|Director of Operations|COO))/gi;
  for (const match of clean.matchAll(pattern)) {
    const name = (match[1]?.replace(/^(Meet|The|Our)\s+/i, "").trim()) || null;
    const role = match[2]?.trim() || "Owner";
    const key = `${name ?? ""}:${role}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, role, evidence: match[0].slice(0, 160) });
    if (out.length >= limit) return out;
  }
  if (!out.length && ROLE_RE.test(clean)) {
    const hit = clean.match(ROLE_RE)?.[0] ?? ELITE_TARGET_ROLES[0];
    out.push({
      name: null,
      role: hit,
      evidence: "Role mentioned on the public page. Person name was not extracted.",
    });
  }
  return out;
}

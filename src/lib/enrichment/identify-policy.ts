import { inspectLinkedInUrl } from "@/lib/linkedin/url";
import { PDL_MIN_LIKELIHOOD } from "@/lib/pdl/constants";
import { normalizePdlLinkedInUrl } from "@/lib/pdl/map-person";

export type IdentifyWriteDecision =
  | { write: false; reason: string }
  | { write: true; url: string; reason: string };

export function canIdentifyLead(input: {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  website?: string | null;
  location?: string | null;
  phone?: string | null;
  twitterUrl?: string | null;
}) {
  if (input.email?.trim()) return true;
  const name = input.name?.trim() ?? "";
  const hasName = name.split(/\s+/).filter(Boolean).length >= 2;
  if (
    hasName &&
    Boolean(input.company?.trim() || input.website?.trim() || input.location?.trim() || input.phone?.trim())
  ) {
    return true;
  }
  // X intent leads often only have a display name + twitterUrl (+ optional location).
  return hasName && Boolean(input.twitterUrl?.trim());
}

export function decideLinkedInIdentifyWrite(input: {
  existingLinkedInUrl?: string | null;
  httpStatus: number;
  likelihood?: number | null;
  linkedinUrl?: string | null;
  minLikelihood?: number;
}): IdentifyWriteDecision {
  const existing = inspectLinkedInUrl(input.existingLinkedInUrl);
  if (existing.kind === "person") {
    return { write: false, reason: "Lead already has a person LinkedIn URL." };
  }
  if (input.httpStatus === 404) {
    return { write: false, reason: "PDL found no licensed match." };
  }
  if (input.httpStatus !== 200) {
    return { write: false, reason: `PDL identify failed (${input.httpStatus}).` };
  }
  const min = input.minLikelihood ?? PDL_MIN_LIKELIHOOD;
  if (typeof input.likelihood !== "number" || input.likelihood < min) {
    return { write: false, reason: `PDL likelihood ${input.likelihood ?? "unknown"} is below ${min}.` };
  }
  const url = normalizePdlLinkedInUrl(input.linkedinUrl);
  const kind = inspectLinkedInUrl(url).kind;
  if (kind !== "person") {
    return { write: false, reason: "PDL match did not include a person LinkedIn URL." };
  }
  return {
    write: true,
    url: url!,
    reason: `PDL person match (likelihood ${input.likelihood}).`,
  };
}

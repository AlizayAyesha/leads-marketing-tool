import { classifyBuyerRole } from "@/lib/outreach/buyer-icp";
import {
  fromEvidenceClaim,
  isStaleEvidence,
  triggerAgeDays,
  triggerFreshness,
  type EvidenceClaim,
  type ObservedEvidence,
  type TriggerFreshness,
} from "@/lib/intelligence/evidence";
import { matchNamedIcp, type NamedIcpId } from "@/lib/intelligence/icps";
import { matchOfferMatrix, type OfferMatrixRow } from "@/lib/intelligence/offer-matrix";
import {
  OFFER_FAMILIES,
  angleForOffer,
  emptyOfferScores,
  pickPrimarySecondary,
  zarServiceForOffer,
  type OfferFamily,
  type OfferMatch,
  type OfferScores,
} from "@/lib/intelligence/offers";

export type CommercialBand = "APPROVE_QUEUE" | "RESEARCH_MORE" | "HOLD" | "REJECT";
export type OpportunitySelection = "PRIORITY" | "NURTURE" | "REJECT";

export type CommercialSignals = {
  metaAdsActive: boolean;
  instagramActive: boolean;
  tiktokActive: boolean;
  googleAdsActive: boolean;
  poorCreative: boolean;
  weakLanding: boolean;
  newLaunch: boolean;
  newLocation: boolean;
  funding: boolean;
  hiringOps: boolean;
  hiringMarketing: boolean;
  hiringSupport: boolean;
  outdatedWebsite: boolean;
  noBooking: boolean;
  whatsappHeavy: boolean;
  multipleLocations: boolean;
  highTicketVisual: boolean;
  luxuryVertical: boolean;
  operationalComplexity: boolean;
  documentHeavy: boolean;
  explicitRequest: boolean;
};

export type CommercialProspect = {
  company?: string | null;
  industry?: string | null;
  location?: string | null;
  website?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  instagramUrl?: string | null;
  roleTitle?: string | null;
  notes?: string | null;
  originalPost?: string | null;
  estimatedEmployees?: number | null;
  highTicket?: boolean;
  softwareAgency?: boolean;
  suppressed?: boolean;
  signals?: Partial<CommercialSignals>;
  evidence?: EvidenceClaim[];
};

export type CommercialBrief = {
  icp: NamedIcpId | null;
  icpLabel: string | null;
  businessModel: string | null;
  businessSizeSignal: string | null;
  buyingTrigger: string | null;
  triggerEvidence: ObservedEvidence[];
  painPoint: string | null;
  painEvidence: ObservedEvidence[];
  technologyGap: string | null;
  technologyEvidence: ObservedEvidence[];
  recommendedOffer: string | null;
  offerReason: string | null;
  whyUs: string | null;
  whyNow: string | null;
  triggerObservedAt: string | null;
  triggerAgeDays: number | null;
  triggerFreshness: TriggerFreshness;
  layers: {
    facts: string[];
    inferences: string[];
    unknowns: string[];
    recommendation: string | null;
  };
  whyPrioritized: {
    whyNow: string;
    observedProblem: string;
    opportunity: string;
    recommendedOffer: string;
    buyer: string;
    evidenceUrl: string | null;
    evidenceSnippet: string | null;
  } | null;
  decisionMaker: string | null;
  decisionMakerRole: string | null;
  decisionMakerConfidence: number;
  outreachAngle: string;
  recommendedCTA: string;
  researchConfidence: number;
  buyNowScore: number;
  abilityToPay: number;
  selection: OpportunitySelection;
};

export type CommercialQualification = {
  band: CommercialBand;
  total: number;
  breakdown: {
    icpFit: number;
    buyingSignal: number;
    painEvidence: number;
    technologyGap: number;
    decisionMaker: number;
    dataQuality: number;
    abilityToPay: number;
  };
  reasons: string[];
  risks: string[];
  offer: OfferMatch;
  rejected: boolean;
  rejectReason: string | null;
  priority: boolean;
  nurture: boolean;
  brief: CommercialBrief;
};

const LUXURY_RE =
  /\b(yacht|superyacht|charter|brokerage|private jet|aviation|hotel|resort|villa|members? club|luxury|real estate|property developer|medspa|aesthetic|hospitality|concierge|chalet)\b/i;

const AGENCY_RE =
  /\b(software agency|web agency|ai agency|coding shop|it (company|services)|digital agency|dev shop)\b/i;

const DM_CONFIDENCE_THRESHOLD = 70;

function clamp(n: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(n)));
}

function stripNegatedMentions(hay: string) {
  return hay.replace(
    /\bno\s+(meta ads?|facebook ads?|instagram(?: ads?)?|tiktok|google ads?|ads?|launch|hiring)\b/gi,
    " ",
  );
}

export function mergeCommercialSignals(p: CommercialProspect): CommercialSignals {
  const hay = stripNegatedMentions(
    `${p.company ?? ""} ${p.industry ?? ""} ${p.notes ?? ""} ${p.originalPost ?? ""}`.toLowerCase(),
  );
  const s = p.signals ?? {};
  return {
    metaAdsActive: s.metaAdsActive ?? /\bmeta ads?|facebook ads?|running ads\b/i.test(hay),
    instagramActive: s.instagramActive ?? (Boolean(p.instagramUrl) || /\binstagram\b/i.test(hay)),
    tiktokActive: s.tiktokActive ?? /\btiktok\b/i.test(hay),
    googleAdsActive: s.googleAdsActive ?? /\bgoogle ads?\b/i.test(hay),
    poorCreative: s.poorCreative ?? /\b(static (ads?|creative)|no video|repetitive creative)\b/i.test(hay),
    weakLanding: s.weakLanding ?? /\b(weak landing|contact form only|generic contact)\b/i.test(hay),
    newLaunch: s.newLaunch ?? /\b(launch|new (property|development|product|summer package))\b/i.test(hay),
    newLocation: s.newLocation ?? /\b(new location|expansion|opening)\b/i.test(hay),
    funding: s.funding ?? /\b(series [abc]|raised|funding)\b/i.test(hay),
    hiringOps: s.hiringOps ?? /\bhiring (operations|ops)\b/i.test(hay),
    hiringMarketing: s.hiringMarketing ?? /\bhiring marketing\b/i.test(hay),
    hiringSupport: s.hiringSupport ?? /\bhiring (support|customer service)\b/i.test(hay),
    outdatedWebsite: s.outdatedWebsite ?? /\b(outdated|slow mobile|old website)\b/i.test(hay),
    noBooking: s.noBooking ?? /\b(no (online )?booking|no scheduling)\b/i.test(hay),
    whatsappHeavy: s.whatsappHeavy ?? /\bwhatsapp\b/i.test(hay),
    multipleLocations: s.multipleLocations ?? /\b(multiple (properties|locations|sites)|12 properties)\b/i.test(hay),
    highTicketVisual: s.highTicketVisual ?? (LUXURY_RE.test(hay) || Boolean(p.highTicket && LUXURY_RE.test(hay))),
    luxuryVertical: s.luxuryVertical ?? (LUXURY_RE.test(hay) || LUXURY_RE.test(p.industry ?? "")),
    operationalComplexity: s.operationalComplexity ?? /\b(multiple systems|customer.service operation|manual|crm|whatsapp inquiries)\b/i.test(hay),
    documentHeavy: s.documentHeavy ?? /\b(documents|knowledge base|rag)\b/i.test(hay),
    explicitRequest: s.explicitRequest ?? /\b(need|looking for|hire|rfp)\b/i.test(hay),
  };
}

export function scoreOfferFamily(offer: OfferFamily, sig: CommercialSignals, luxury: boolean): number {
  if (offer === "AI_VIDEO_ADS") {
    let n = 20;
    if (luxury || sig.highTicketVisual) n += 22;
    if (sig.metaAdsActive || sig.instagramActive || sig.tiktokActive) n += 22;
    if (sig.highTicketVisual && (sig.metaAdsActive || sig.instagramActive)) n += 10;
    if (sig.poorCreative) n += 12;
    if (sig.newLaunch) n += 12;
    if (sig.instagramActive) n += 8;
    if (!(sig.metaAdsActive || sig.instagramActive || sig.tiktokActive) && !luxury) n -= 20;
    return clamp(n, 100);
  }
  if (offer === "GRAPHICS") {
    let n = 12;
    if (luxury || sig.highTicketVisual) n += 14;
    if (sig.poorCreative && !(sig.metaAdsActive && sig.newLaunch)) n += 12;
    if (sig.newLaunch && !sig.metaAdsActive) n += 10;
    if (luxury && !sig.metaAdsActive && !sig.instagramActive) n += 8;
    return clamp(n, 100);
  }
  if (offer === "AI_ARCHITECTURE") {
    let n = 18;
    if (sig.operationalComplexity) n += 22;
    if (sig.multipleLocations) n += 16;
    if (sig.whatsappHeavy) n += 14;
    if (sig.hiringSupport || sig.hiringOps) n += 10;
    if (sig.documentHeavy) n += 8;
    if (sig.documentHeavy && sig.operationalComplexity) n += 10;
    if (sig.funding) n += 8;
    if (!sig.operationalComplexity && !sig.multipleLocations && !sig.whatsappHeavy) n -= 10;
    return clamp(n, 100);
  }
  if (offer === "AUTOMATION") {
    let n = 18;
    if (sig.operationalComplexity) n += 20;
    if (sig.weakLanding || sig.noBooking) n += 14;
    if (sig.whatsappHeavy) n += 14;
    if (sig.multipleLocations) n += 12;
    if (sig.hiringOps || sig.hiringSupport) n += 10;
    if (sig.metaAdsActive) n += 8;
    return clamp(n, 100);
  }
  let n = 16;
  if (sig.outdatedWebsite) n += 22;
  if (sig.noBooking) n += 20;
  if (sig.weakLanding) n += 14;
  if (sig.explicitRequest) n += 12;
  if (luxury && (sig.outdatedWebsite || sig.noBooking)) n += 10;
  return clamp(n, 100);
}

function emptyOffer(): OfferMatch {
  return buildMatch(emptyOfferScores(), {
    company: null,
    notes: "",
  });
}

function emptyBrief(overrides: Partial<CommercialBrief> = {}): CommercialBrief {
  return {
    icp: null,
    icpLabel: null,
    businessModel: null,
    businessSizeSignal: null,
    buyingTrigger: null,
    triggerEvidence: [],
    painPoint: null,
    painEvidence: [],
    technologyGap: null,
    technologyEvidence: [],
    recommendedOffer: null,
    offerReason: null,
    whyUs: null,
    whyNow: null,
    decisionMaker: null,
    decisionMakerRole: null,
    decisionMakerConfidence: 0,
    outreachAngle: "DIGITAL_CONVERSION",
    recommendedCTA: "Do not contact until evidence exists.",
    researchConfidence: 0,
    buyNowScore: 0,
    abilityToPay: 0,
    selection: "REJECT",
    triggerObservedAt: null,
    triggerAgeDays: null,
    triggerFreshness: "unknown",
    layers: { facts: [], inferences: [], unknowns: ["No commercial brief yet."], recommendation: null },
    whyPrioritized: null,
    ...overrides,
  };
}

function rejectQualification(
  reason: string,
  rejectReason: string,
  extra?: Partial<CommercialQualification>,
): CommercialQualification {
  const offer = extra?.offer ?? emptyOffer();
  return {
    band: "REJECT",
    total: 0,
    breakdown: {
      icpFit: 0,
      buyingSignal: 0,
      painEvidence: 0,
      technologyGap: 0,
      decisionMaker: 0,
      dataQuality: 0,
      abilityToPay: 0,
    },
    reasons: [],
    risks: [reason],
    offer,
    rejected: true,
    rejectReason,
    priority: false,
    nurture: false,
    brief: emptyBrief({ selection: "REJECT" }),
    ...extra,
  };
}

export function qualifyCommercial(prospect: CommercialProspect): CommercialQualification {
  const hay = `${prospect.company ?? ""} ${prospect.industry ?? ""} ${prospect.roleTitle ?? ""} ${prospect.notes ?? ""} ${prospect.originalPost ?? ""}`;
  const agency = prospect.softwareAgency || AGENCY_RE.test(hay);
  const buyer = classifyBuyerRole(prospect.roleTitle, prospect.company ?? prospect.industry);

  if (prospect.suppressed) {
    return rejectQualification("Already suppressed / do-not-contact.", "SUPPRESSED");
  }
  if (agency) {
    return rejectQualification(
      "Software / AI / web agency — excluded unless a campaign explicitly allows it.",
      "PROHIBITED_INDUSTRY",
    );
  }

  const sig = mergeCommercialSignals(prospect);
  const icpMatch = matchNamedIcp(hay);
  const observed = (prospect.evidence ?? []).map((item, _, all) => fromEvidenceClaim(item, all));
  const allFacts = observed.filter((item) => item.type === "FACT");
  const staleFacts = allFacts.filter((item) => isStaleEvidence(item.observedAt));
  const facts = allFacts.filter((item) => !isStaleEvidence(item.observedAt));
  const hypotheses = observed.filter((item) => item.type === "HYPOTHESIS");

  const keywordTriggers = keywordTriggerHypotheses(sig);
  const staleTriggers = staleFacts.filter((item) =>
    /launch|expand|hir|fund|rebrand|new (market|location|product|branch|property|route|fleet)/i.test(item.claim),
  );
  const triggerEvidence = [
    ...facts.filter((item) => /launch|expand|hir|fund|rebrand|new (market|location|product|branch|property|route|fleet)/i.test(item.claim)),
    ...staleTriggers,
    ...keywordTriggers,
  ];
  const factTriggers = triggerEvidence.filter((item) => item.type === "FACT" && !isStaleEvidence(item.observedAt));

  const painKeywords = keywordPainHypotheses(sig);
  const painEvidence = [
    ...facts.filter((item) => /form|booking|whatsapp|landing|manual|crm|outdated|inquiry|qualification|follow-up/i.test(item.claim)),
    ...painKeywords,
  ];
  const factPain = painEvidence.filter((item) => item.type === "FACT");

  const matrix = matchOfferMatrix({
    ads: sig.metaAdsActive || sig.googleAdsActive,
    weakLanding: sig.weakLanding,
    noBooking: sig.noBooking,
    whatsapp: sig.whatsappHeavy,
    multipleLocations: sig.multipleLocations,
    outdatedWebsite: sig.outdatedWebsite,
    hiring: sig.hiringOps || sig.hiringMarketing || sig.hiringSupport,
    opsComplexity: sig.operationalComplexity,
  });

  const scores = emptyOfferScores();
  for (const family of OFFER_FAMILIES) {
    scores[family] = scoreOfferFamily(family, sig, sig.luxuryVertical);
  }
  const offer = buildMatch(scores, prospect);
  const matrixOrOffer = matrix ?? fallbackMatrixFromOffer(offer, sig);

  const reasons: string[] = [];
  const risks: string[] = [];

  let icpFit = 4;
  if (icpMatch.confirmed) {
    icpFit += 18;
    reasons.push(icpMatch.reason);
    if (prospect.location && icpMatch.icp?.targetGeographies.some((geo) => new RegExp(geo, "i").test(prospect.location ?? ""))) {
      icpFit += 3;
    }
  } else if (sig.luxuryVertical) {
    icpFit += 4;
    risks.push("Luxury language is not an ICP. Named ICP not confirmed.");
  } else if (buyer.ok) {
    icpFit += 6;
    risks.push("Buyer role present but no named ICP.");
  } else {
    risks.push(icpMatch.reason);
  }
  icpFit = clamp(icpFit, 25);

  let buyingSignal = 0;
  if (factTriggers.length) {
    buyingSignal += 18;
    reasons.push("Evidence-backed buying trigger.");
  } else if (keywordTriggers.length) {
    buyingSignal += 10;
    risks.push("Buying trigger is a hypothesis (no source URL + snippet).");
  }
  if (sig.metaAdsActive && factTriggers.length) buyingSignal += 4;
  else if (sig.metaAdsActive) buyingSignal += 3;
  if (buyingSignal === 0) risks.push("No buying trigger.");
  buyingSignal = clamp(buyingSignal, 25);

  let painPts = 0;
  if (factPain.length) {
    painPts += 14;
    reasons.push("Evidence-backed problem/opportunity.");
  } else if (painKeywords.length || matrix) {
    painPts += 8;
    risks.push("Problem/opportunity is not FACT-backed.");
  }
  if (sig.explicitRequest) painPts += 4;
  if (painPts === 0) risks.push("No evidenced pain — do not invent a problem.");
  painPts = clamp(painPts, 20);

  let technologyGap = 0;
  if (matrix) {
    technologyGap += 10;
    reasons.push(`Offer matrix: ${matrix.specificOffer}.`);
  }
  if (sig.noBooking || sig.outdatedWebsite || sig.operationalComplexity || sig.weakLanding) technologyGap += 5;
  if (offer.scores[offer.primary] >= 70) technologyGap += 2;
  technologyGap = clamp(technologyGap, 15);

  let decisionMaker = 0;
  let dmConfidence = 12;
  if (buyer.ok) {
    decisionMaker = 10;
    dmConfidence = 86;
    reasons.push(buyer.reason);
  } else if (prospect.roleTitle && /cmo|marketing director|coo|operations|owner|ceo|founder|managing director|principal|partner/i.test(prospect.roleTitle)) {
    decisionMaker = 8;
    dmConfidence = 72;
  } else if (prospect.roleTitle) {
    decisionMaker = 3;
    dmConfidence = 38;
    risks.push("Decision-maker role is weak or unconfirmed.");
  } else {
    dmConfidence = 8;
    risks.push("No identifiable decision maker.");
  }

  let dataQuality = 0;
  if (prospect.email) dataQuality += 2;
  if (prospect.linkedinUrl) dataQuality += 1;
  if (facts.length) dataQuality += 2;
  if (!prospect.email && !prospect.linkedinUrl) risks.push("No reachable contact.");
  if (hypotheses.length && !facts.length) risks.push("All external claims are hypotheses.");
  dataQuality = clamp(dataQuality, 5);

  let abilityToPay = 4;
  if (sig.luxuryVertical || prospect.highTicket) abilityToPay += 6;
  if ((prospect.estimatedEmployees ?? 0) >= 11) abilityToPay += 3;
  if (sig.metaAdsActive) abilityToPay += 2;
  abilityToPay = clamp(abilityToPay, 15);

  const total = icpFit + buyingSignal + painPts + technologyGap + decisionMaker + dataQuality;

  const inactive = !prospect.website && !prospect.email && !prospect.linkedinUrl;
  const tiny = (prospect.estimatedEmployees ?? 99) <= 3 && !icpMatch.confirmed && buyingSignal === 0 && painPts === 0;
  const noContact = !prospect.email && !prospect.linkedinUrl;
  const speculationOnly = facts.length === 0 && (Boolean(sig.newLaunch) || Boolean(sig.newLocation));
  const noOffer = !matrixOrOffer || offer.scores[offer.primary] < 40;

  const whyNowFact = factTriggers[0] ?? null;
  const whyNow =
    whyNowFact?.claim ??
    (keywordTriggers[0] && keywordTriggers[0].type === "FACT" ? keywordTriggers[0].claim : null);
  const whyUs = matrixOrOffer
    ? `${matrixOrOffer.problem} → ${matrixOrOffer.ourSolution}.`
    : null;

  const priorityGate = evaluatePriorityGate({
    icpConfirmed: icpMatch.confirmed,
    factWhyNow: Boolean(whyNowFact?.claim && whyNowFact.sourceUrl && whyNowFact.snippet && whyNowFact.type === "FACT"),
    factProblem: factPain.length >= 1 || (Boolean(matrix) && facts.some((item) => item.type === "FACT")),
    offer: Boolean(matrixOrOffer) && !noOffer,
    dm: dmConfidence >= DM_CONFIDENCE_THRESHOLD,
    staleTrigger: Boolean(whyNowFact && isStaleEvidence(whyNowFact.observedAt)),
  });
  const priority = priorityGate.ok;
  for (const blocker of priorityGate.blockers) risks.push(`PRIORITY blocked: ${blocker}.`);

  let rejectReason: string | null = null;
  let rejected = false;
  if (tiny) {
    rejected = true;
    rejectReason = "LOW_TICKET_NO_SIGNAL";
  } else if (inactive) {
    rejected = true;
    rejectReason = "INACTIVE";
  } else if (noContact && decisionMaker < 8) {
    rejected = true;
    rejectReason = "NO_DECISION_MAKER";
  } else if (noOffer && !icpMatch.confirmed && total < 50) {
    rejected = true;
    rejectReason = "NO_CREDIBLE_OFFER";
  } else if (speculationOnly && total < 50) {
    rejected = true;
    rejectReason = "SPECULATION_ONLY";
  } else if (staleFacts.length && factTriggers.length === 0 && total < 50) {
    rejected = true;
    rejectReason = "STALE_TRIGGER";
  } else if (total < 50 && !icpMatch.confirmed) {
    rejected = true;
    rejectReason = "SCORE_BELOW_50";
  }

  const nurture = !rejected && !priority;
  let band: CommercialBand = "REJECT";
  if (rejected) band = "REJECT";
  else if (priority && total >= 80) band = "APPROVE_QUEUE";
  else if (priority) band = "RESEARCH_MORE";
  else if (nurture && total >= 65) band = "RESEARCH_MORE";
  else if (nurture) band = "HOLD";
  else band = "REJECT";

  const selection: OpportunitySelection = rejected ? "REJECT" : priority ? "PRIORITY" : "NURTURE";
  const researchConfidence = clamp(
    (facts.length ? 40 : 10) + (icpMatch.confirmed ? 20 : 0) + (whyNowFact ? 20 : 0) + Math.round(dataQuality * 4),
    100,
  );

  const brief: CommercialBrief = {
    icp: icpMatch.icp?.id ?? null,
    icpLabel: icpMatch.icp?.label ?? null,
    businessModel: icpMatch.businessModel,
    businessSizeSignal:
      (prospect.estimatedEmployees ?? 0) >= 11 ? "11+ employees (informational)" : sig.luxuryVertical ? "High-ticket positioning (informational)" : "Unknown size",
    buyingTrigger: whyNow,
    triggerEvidence,
    painPoint: matrixOrOffer?.problem ?? (factPain[0]?.claim || painKeywords[0]?.claim || null),
    painEvidence,
    technologyGap: matrixOrOffer?.technologyOpportunity ?? null,
    technologyEvidence: facts.filter((item) => /site|form|crm|booking|system|workflow/i.test(item.claim)),
    recommendedOffer: matrixOrOffer?.specificOffer ?? null,
    offerReason: matrixOrOffer ? `${matrixOrOffer.signal} → ${matrixOrOffer.ourSolution}` : null,
    whyUs,
    whyNow,
    triggerObservedAt: (whyNowFact ?? staleTriggers[0])?.observedAt ?? null,
    triggerAgeDays: (whyNowFact ?? staleTriggers[0]) ? triggerAgeDays((whyNowFact ?? staleTriggers[0])!.observedAt) : null,
    triggerFreshness: triggerFreshness((whyNowFact ?? staleTriggers[0])?.observedAt ?? null),
    layers: {
      facts: [
        ...facts.map((item) => item.claim),
      ].slice(0, 6),
      inferences: [
        ...observed.filter((item) => item.type === "INFERENCE" || item.type === "HYPOTHESIS").map((item) => item.claim),
      ].slice(0, 6),
      unknowns: [
        ...(whyNowFact ? [] : ["Whether a current buying trigger exists"]),
        "Whether they are currently shopping for automation",
      ],
      recommendation: matrixOrOffer
        ? `Position ${matrixOrOffer.specificOffer} rather than a generic catalog pitch.`
        : "Do not recommend an offer until a FACT problem exists.",
    },
    whyPrioritized: priority && whyNowFact && matrixOrOffer
      ? {
          whyNow: whyNowFact.claim,
          observedProblem: matrixOrOffer.problem,
          opportunity: matrixOrOffer.technologyOpportunity,
          recommendedOffer: matrixOrOffer.specificOffer,
          buyer: `${prospect.roleTitle ?? "Unknown role"} — ${(dmConfidence / 100).toFixed(2)} confidence.`,
          evidenceUrl: whyNowFact.sourceUrl,
          evidenceSnippet: whyNowFact.snippet,
        }
      : null,
    decisionMaker: prospect.roleTitle ?? null,
    decisionMakerRole: prospect.roleTitle ?? null,
    decisionMakerConfidence: dmConfidence,
    outreachAngle: offer.angle,
    recommendedCTA: priority && matrixOrOffer ? matrixOrOffer.cta : "Do not send. Nurture or research until Why Now is FACT.",
    researchConfidence,
    buyNowScore: total,
    abilityToPay,
    selection,
  };

  return {
    band,
    total,
    breakdown: {
      icpFit,
      buyingSignal,
      painEvidence: painPts,
      technologyGap,
      decisionMaker,
      dataQuality,
      abilityToPay,
    },
    reasons,
    risks,
    offer,
    rejected,
    rejectReason,
    priority,
    nurture,
    brief,
  };
}

function keywordTriggerHypotheses(sig: CommercialSignals): ObservedEvidence[] {
  const rows: Array<[boolean, string]> = [
    [sig.newLocation, "Possible expansion / new location (hypothesis — no source URL)."],
    [sig.newLaunch, "Possible launch / new product (hypothesis — no source URL)."],
    [sig.funding, "Possible funding event (hypothesis — no source URL)."],
    [sig.hiringOps || sig.hiringMarketing, "Possible hiring signal (hypothesis — no source URL)."],
    [sig.metaAdsActive, "Possible active advertising (hypothesis — no source URL)."],
  ];
  return rows
    .filter(([ok]) => ok)
    .map(([, claim]) => ({
      claim,
      sourceUrl: null,
      snippet: "",
      observedAt: new Date().toISOString(),
      confidence: 35,
      type: "HYPOTHESIS" as const,
    }));
}

function keywordPainHypotheses(sig: CommercialSignals): ObservedEvidence[] {
  const rows: Array<[boolean, string]> = [
    [sig.weakLanding, "Generic / weak inquiry path (hypothesis)."],
    [sig.noBooking, "No online booking observed in notes (hypothesis)."],
    [sig.whatsappHeavy, "WhatsApp-heavy intake (hypothesis)."],
    [sig.outdatedWebsite, "Outdated website (hypothesis)."],
    [sig.operationalComplexity, "Operational complexity / manual follow-up (hypothesis)."],
  ];
  return rows
    .filter(([ok]) => ok)
    .map(([, claim]) => ({
      claim,
      sourceUrl: null,
      snippet: "",
      observedAt: new Date().toISOString(),
      confidence: 35,
      type: "HYPOTHESIS" as const,
    }));
}

function fallbackMatrixFromOffer(offer: OfferMatch, sig: CommercialSignals): OfferMatrixRow | null {
  if (offer.scores[offer.primary] < 60) return null;
  return matchOfferMatrix({
    ads: sig.metaAdsActive,
    weakLanding: sig.weakLanding,
    noBooking: sig.noBooking,
    whatsapp: sig.whatsappHeavy,
    multipleLocations: sig.multipleLocations,
    outdatedWebsite: sig.outdatedWebsite,
    hiring: sig.hiringOps || sig.hiringMarketing,
    opsComplexity: sig.operationalComplexity,
  });
}

function buildMatch(scores: OfferScores, prospect: CommercialProspect): OfferMatch {
  const { primary, secondary } = pickPrimarySecondary(scores);
  const sig = mergeCommercialSignals(prospect);
  return {
    scores,
    primary,
    secondary,
    angle: angleForOffer(primary, { launch: sig.newLaunch, ads: sig.metaAdsActive || sig.instagramActive }),
    zarService: zarServiceForOffer(primary),
  };
}

export function evaluatePriorityGate(input: {
  icpConfirmed: boolean;
  factWhyNow: boolean;
  factProblem: boolean;
  offer: boolean;
  dm: boolean;
  staleTrigger: boolean;
}) {
  const blockers: string[] = [];
  if (!input.icpConfirmed) blockers.push("named ICP not confirmed");
  if (!input.factWhyNow) blockers.push("no FACT Why Now with URL + snippet");
  if (input.staleTrigger) blockers.push("Why Now evidence is stale");
  if (!input.factProblem) blockers.push("no evidenced problem");
  if (!input.offer) blockers.push("no your business offer");
  if (!input.dm) blockers.push("decision-maker confidence below threshold");
  return { ok: blockers.length === 0, blockers };
}

export function outboundWhyNowAllowed(q: CommercialQualification) {
  const fact = q.brief.triggerEvidence.find((item) => item.type === "FACT" && item.sourceUrl && item.snippet);
  return Boolean(
    q.priority &&
      q.brief.whyNow &&
      fact &&
      q.brief.triggerFreshness !== "stale",
  );
}

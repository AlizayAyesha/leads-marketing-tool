import { getBusinessProfile } from "@/lib/business/profile";
export const CONVERSATION_OBJECTIVE = {
  primary: "Convert qualified conversations into meetings for your business services.",
  secondary: "Establish enough rapport and context to make the offer relevant.",
  method: "Natural conversation is the method. Selling is the objective.",
  forbid:
    "Do not give away the deliverable. Never write code, debug, design architecture, create workflows, give implementation plans, SEO strategies, tool recommendations, or free consulting in chat. Position your business and move to a meeting.",
  pitchWhen: "Pitch when a offer-relevant need is on the table. Ask only enough to qualify a sale, never enough to start solving.",
  kpi: "Every message should move a qualified prospect toward hiring your business. Connection volume is a ceiling, not a goal.",
} as const;

export const COMMERCIAL_NON_CONSULTING_GUARDRAIL = `Jarvis is a salesperson for ${getBusinessProfile().businessName}, not a free consultant.
The purpose of LinkedIn conversation is to convert qualified prospects into sales meetings.
NEVER write code, debug, design architecture, create an automation workflow, give a step-by-step implementation, provide a detailed SEO strategy, recommend specific tools as a free solution, create a business strategy, brainstorm ideas, give a technical roadmap, or solve the problem inside the conversation.
When a prospect asks for any of the above: acknowledge the goal, position the relevant service you offer, and move toward a sales meeting at https://zarlabs.online/go/linkedin.
Do not give away the deliverable. Prospect need → ${getBusinessProfile().businessName} service → sales meeting.`;

export const CONVERSATION_STAGES = [
  "NONE",
  "CONNECTED",
  "GETTING_TO_KNOW",
  "DISCOVERY",
  "PROBLEM_IDENTIFIED",
  "SOLUTION_MATCH",
  "PITCH",
  "INTEREST",
  "MEETING",
  "MEETING_PROPOSED",
  "LINK_SENT",
  "BOOKING_STARTED",
  "BOOKED",
  "MEETING_BOOKED",
  "COMPLETED",
  "STOPPED",
] as const;

export type ConversationStage = (typeof CONVERSATION_STAGES)[number];

export const CONVERSATION_REPLY_STEP = "CONVERSATION_REPLY";

export const STAGE_RANK: Record<ConversationStage, number> = {
  NONE: 0,
  CONNECTED: 1,
  GETTING_TO_KNOW: 2,
  DISCOVERY: 3,
  PROBLEM_IDENTIFIED: 4,
  SOLUTION_MATCH: 5,
  PITCH: 6,
  INTEREST: 7,
  MEETING: 8,
  MEETING_PROPOSED: 8,
  LINK_SENT: 9,
  BOOKING_STARTED: 10,
  BOOKED: 11,
  MEETING_BOOKED: 11,
  COMPLETED: 12,
  STOPPED: 99,
};

export const PITCH_STAGES: ConversationStage[] = [
  "SOLUTION_MATCH",
  "PITCH",
  "INTEREST",
  "MEETING",
  "MEETING_PROPOSED",
  "LINK_SENT",
  "BOOKING_STARTED",
  "BOOKED",
  "MEETING_BOOKED",
  "COMPLETED",
];

export const CONVERSATION_HEATS = ["COLD", "ENGAGED", "PROBLEM", "QUALIFIED", "HOT", "MEETING"] as const;
export type ConversationHeat = (typeof CONVERSATION_HEATS)[number];

export type BuyingIntentScore = 0 | 1 | 2 | 3 | 4 | 5;

export type ConversationCue =
  | "no_reply"
  | "casual"
  | "problem"
  | "asked_what_you_do"
  | "asked_for_help"
  | "interested"
  | "buying_intent"
  | "meeting"
  | "booked"
  | "booking_started"
  | "maybe_later"
  | "decline"
  | "dnc";

export type WhyNowSignals = {
  urgency: boolean;
  timeline: string | null;
  budget_signal: boolean;
  active_project: boolean;
  growth_event: boolean;
  hiring: boolean;
  launch: boolean;
  fundraising: boolean;
  expansion: boolean;
};

export type ConversationMatch = {
  pain: string | null;
  matched: boolean;
  specific: boolean;
  strength: "none" | "weak" | "strong";
  buyingSignal: boolean;
  buyingSignalReason: string | null;
  service: string | null;
  serviceLabel: string | null;
  capability: string | null;
  outcome: string | null;
  valueProp: string | null;
};

export type ConversationAnalysis = {
  cue: ConversationCue;
  signal: string | null;
  problem: string | null;
  matchesOffer: boolean;
  match: ConversationMatch;
  whyNow: WhyNowSignals;
  intentScore: BuyingIntentScore;
  intentReason: string;
  heat: ConversationHeat;
  pitchAllowed: boolean;
  doNotPitch: boolean;
  summary: string;
  text?: string;
};

export type ConversationDecision = {
  from: ConversationStage;
  to: ConversationStage;
  code: string;
  reason: string;
  pitchAllowed: boolean;
  stopRelationship: boolean;
  wait: boolean;
  intentScore: BuyingIntentScore;
  heat: ConversationHeat;
};

export type ConversationContext = {
  firstName: string;
  company: string | null;
  headline: string | null;
  about: string | null;
  roleTitle: string | null;
  websiteTitle: string | null;
  observation: string | null;
  bookingUrl?: string | null;
  channel?: "EMAIL" | "LINKEDIN" | "INSTAGRAM" | "FACEBOOK" | "X_TWITTER";
  publicLeadId?: string | null;
  conversationId?: string | null;
};

export function isConversationStage(value: unknown): value is ConversationStage {
  return typeof value === "string" && (CONVERSATION_STAGES as readonly string[]).includes(value);
}

export function normalizeConversationStage(value: unknown): ConversationStage | null {
  if (value === "SOLUTION_RELEVANT") return "SOLUTION_MATCH";
  if (value === "SOFT_PITCH") return "PITCH";
  if (value === "MEETING") return "MEETING_PROPOSED";
  if (value === "BOOKED") return "MEETING_BOOKED";
  return isConversationStage(value) ? value : null;
}

export function firstNameFrom(name?: string | null) {
  const part = name?.trim().split(/\s+/)[0];
  return part || "there";
}

export function emptyWhyNow(): WhyNowSignals {
  return {
    urgency: false,
    timeline: null,
    budget_signal: false,
    active_project: false,
    growth_event: false,
    hiring: false,
    launch: false,
    fundraising: false,
    expansion: false,
  };
}

export function countWhyNow(signals: WhyNowSignals) {
  return (Object.entries(signals) as Array<[string, boolean | string | null]>).filter(([, value]) =>
    typeof value === "string" ? Boolean(value) : Boolean(value),
  ).length;
}

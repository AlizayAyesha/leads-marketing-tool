import { getBusinessProfile } from "@/lib/business/profile";
import { WEBSITE_MEETING_URL } from "@/lib/conversation/booking";

export type ReplyIntent =
  | "INTERESTED"
  | "MAYBE_LATER"
  | "NOT_INTERESTED"
  | "NEEDS_PRICING"
  | "WANTS_PORTFOLIO"
  | "WANTS_MEETING"
  | "ASKS_EMAIL"
  | "WRONG_PERSON"
  | "UNSUBSCRIBE"
  | "OTHER";

export type ReplyClassification = {
  intent: ReplyIntent;
  stopSequence: boolean;
  escalate: boolean;
  leadStatus: "REPLIED" | "INTERESTED" | "MEETING" | "LOST" | "DO_NOT_CONTACT" | null;
  suppress: boolean;
  summary: string;
};

const RULES: Array<{ intent: ReplyIntent; re: RegExp }> = [
  { intent: "UNSUBSCRIBE", re: /\b(unsubscribe|stop emailing|remove me|opt[- ]?out|do not contact)\b/i },
  { intent: "WRONG_PERSON", re: /\b(wrong person|not the right (person|contact)|no longer (here|with)|left the company)\b/i },
  {
    intent: "ASKS_EMAIL",
    re: /\b(your (email|e-mail)|email address|e-mail address|send (me )?your email|what('?s| is) your email|drop (your )?email|start with your email)\b/i,
  },
  { intent: "WANTS_MEETING", re: /\b(let'?s talk|book a (call|meeting)|schedule|calendly|available (to )?chat|sure,? let'?s|10-minute|10 min)\b/i },
  { intent: "NEEDS_PRICING", re: /\b(pric(e|ing)|cost|quote|how much|retainer|budget)\b/i },
  { intent: "WANTS_PORTFOLIO", re: /\b(portfolio|case stud|examples? of (your )?work|past work)\b/i },
  { intent: "NOT_INTERESTED", re: /\b(not interested|no thanks|no thank you|we're (all )?set|we are (all )?set|please don'?t|leave me alone|stop (messaging|dm|dms|texting))\b/i },
  { intent: "MAYBE_LATER", re: /\b(later|next quarter|next year|not now|revisit|circle back|in a few months)\b/i },
  { intent: "INTERESTED", re: /\b(interested|tell me more|sounds good|this is relevant|can you share more|happy to hear|useful fit)\b/i },
];

/** Short hard declines — common on X DMs. */
const SHORT_NO_RE = /^(no|nah|nope|no\.|pass|hard pass|not interested)[.!]*$/i;

export function classifyReply(text: string): ReplyClassification {
  const body = text.trim();
  if (SHORT_NO_RE.test(body)) return classifyIntent("NOT_INTERESTED", body);
  const matched = RULES.find((rule) => rule.re.test(body));
  const intent = matched?.intent ?? "OTHER";
  return classifyIntent(intent, body);
}

export function classifyIntent(intent: ReplyIntent, text = ""): ReplyClassification {
  if (intent === "UNSUBSCRIBE") {
    return {
      intent,
      stopSequence: true,
      escalate: false,
      leadStatus: "DO_NOT_CONTACT",
      suppress: true,
      summary: "Unsubscribe / opt-out detected. Sequence stops and the address is suppressed.",
    };
  }
  if (intent === "NOT_INTERESTED") {
    return {
      intent,
      stopSequence: true,
      escalate: false,
      leadStatus: "DO_NOT_CONTACT",
      suppress: true,
      summary: "Not interested / said no. Sequence stops. Never message again.",
    };
  }
  if (intent === "WRONG_PERSON") {
    return {
      intent,
      stopSequence: true,
      escalate: false,
      leadStatus: "REPLIED",
      suppress: false,
      summary: "Wrong person. Sequence stops. Do not keep messaging this inbox.",
    };
  }
  if (intent === "ASKS_EMAIL") {
    return {
      intent,
      stopSequence: true,
      escalate: true,
      leadStatus: "INTERESTED",
      suppress: false,
      summary: "They asked for email / contact. Send your contact address and escalate.",
    };
  }
  if (intent === "WANTS_MEETING") {
    return {
      intent,
      stopSequence: true,
      escalate: true,
      leadStatus: "MEETING",
      suppress: false,
      summary: "They asked to talk. Escalate and send the booking process.",
    };
  }
  if (intent === "INTERESTED" || intent === "NEEDS_PRICING" || intent === "WANTS_PORTFOLIO") {
    return {
      intent,
      stopSequence: true,
      escalate: true,
      leadStatus: "INTERESTED",
      suppress: false,
      summary: "Positive commercial reply. Stop the cadence and escalate to you.",
    };
  }
  if (intent === "MAYBE_LATER") {
    return {
      intent,
      stopSequence: true,
      escalate: false,
      leadStatus: "REPLIED",
      suppress: false,
      summary: "Timing is later. Sequence stops so we do not keep nudging.",
    };
  }
  return {
    intent: "OTHER",
    stopSequence: true,
    escalate: true,
    leadStatus: "REPLIED",
    suppress: false,
    summary: text.trim()
      ? "A reply arrived. Sequence stops until you review it."
      : "Empty reply text.",
  };
}

export function ourContactEmail() {
  return (process.env.OUTREACH_FROM_EMAIL ?? "").trim() || "you@example.com";
}

export function suggestedReply(input: {
  intent: ReplyIntent;
  name?: string | null;
  bookingUrl?: string;
  contactEmail?: string | null;
  channel?: "EMAIL" | "X_TWITTER" | "LINKEDIN" | string | null;
}): { subject: string; message: string } {
  const who = input.name?.split(" ")[0] || "there";
  const email = (input.contactEmail ?? "").trim() || ourContactEmail();
  const social = input.channel === "X_TWITTER" || input.channel === "LINKEDIN";
  const book = (input.bookingUrl ?? "").trim() || WEBSITE_MEETING_URL;
  const bookLine = `Book a short meeting here: ${book}`;

  if (input.intent === "ASKS_EMAIL") {
    if (social) {
      return {
        subject: "",
        message: `Appreciate that — happy to chat. Best email is ${email}. ${bookLine}`,
      };
    }
    return {
      subject: "your business — let's book a time",
      message: `Hi ${who},\n\nThanks for reaching out. You can reach us at ${email}.\n\n${bookLine}\n\n— ${getBusinessProfile().businessName}`,
    };
  }
  if (input.intent === "WANTS_MEETING") {
    if (social) {
      return {
        subject: "",
        message: `Glad this is useful. ${bookLine}`,
      };
    }
    return {
      subject: "Times to talk",
      message: `Hi ${who},\n\nGlad this is useful. ${bookLine}\n\nIf email is easier: ${email}\n\n— ${getBusinessProfile().businessName}`,
    };
  }
  if (input.intent === "NEEDS_PRICING") {
    const message = social
      ? `Happy to talk scope/pricing on a quick call. ${bookLine}`
      : `Hi ${who},\n\nHappy to talk numbers once I understand the problem. ${bookLine}\n\n— ${getBusinessProfile().businessName}`;
    return { subject: "Scope before a number", message };
  }
  if (input.intent === "WANTS_PORTFOLIO") {
    const message = social
      ? `I can walk through two relevant examples on a short call. ${bookLine}`
      : `Hi ${who},\n\nI can share two relevant examples on a short call rather than a generic deck. ${bookLine}\n\n— ${getBusinessProfile().businessName}`;
    return { subject: "Relevant work", message };
  }
  if (input.intent === "INTERESTED") {
    const message = social
      ? `Thanks — let's make the next step useful. ${bookLine}`
      : `Hi ${who},\n\nThanks for writing back. ${bookLine}\n\n— ${getBusinessProfile().businessName}`;
    return { subject: "Next step", message };
  }
  if (input.intent === "UNSUBSCRIBE" || input.intent === "NOT_INTERESTED") {
    return {
      subject: "",
      message: "",
    };
  }
  if (social) {
    return {
      subject: "",
      message: `Thanks for writing back. ${bookLine}`,
    };
  }
  return {
    subject: "Re: next step",
    message: `Hi ${who},\n\nThanks for writing back. ${bookLine}\n\n— ${getBusinessProfile().businessName}`,
  };
}

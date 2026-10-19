import { getBusinessProfile } from "@/lib/business/profile";
import {
  LINKEDIN_MEETING_HOST,
  LINKEDIN_MEETING_URL,
  bookingUrlForDraft,
  linkedInCtaAllowedStage,
} from "@/lib/conversation/booking";
import {
  COMMERCIAL_NON_CONSULTING_GUARDRAIL,
  CONVERSATION_OBJECTIVE,
  firstNameFrom,
  type ConversationContext,
  type ConversationCue,
  type ConversationMatch,
  type ConversationStage,
} from "@/lib/conversation/types";

const PREMATURE_PITCH_RE =
  /\b(ai-powered|we build|would you like a call|want to have a quick call|book a (call|demo)|here's a link|pitch deck|our services|grab a time here)\b/i;

const CONSULTING_RE =
  /\b(you should|you could use|implement lead scoring|webhooks|qualification agent|here are \d|step 1|7 ways|optimize your operations|core web vitals|where (is it |are you )hosted|what technologies|what'?s your (current )?crm|how many leads|where does (the )?process break|implementation plan|step[- ]by[- ]step|hosted on|\bn8n\b|\bzapier\b|\bmake\.com\b|use hubspot|connect hubspot|keyword research|schema markup|try using|i recommend using|here'?s (some )?code|```|function\s+\w+\()\b/i;

const BROCHURE_RE =
  /\b(we provide ai|ai, web development, automation and seo|web development, automation and seo|our (full )?service(s)? (list|offering|include))\b/i;

const BOOKING_LINK_RE = /\/go\/linkedin|grab a time here|here's a link to book/i;

const COMMERCIAL_POSITIONING =
  "We build custom software, AI systems and automation for businesses — from websites and SaaS platforms to automated sales and lead workflows. If you're looking at improving something on your side, I'd be happy to show you what we could build.";

export function conversationObservation(ctx: ConversationContext) {
  const bits = [ctx.headline, ctx.roleTitle, ctx.company, ctx.websiteTitle, ctx.about, ctx.observation]
    .map((item) => item?.replace(/\s+/g, " ").trim())
    .filter((item): item is string => Boolean(item && item.length > 3));
  return bits[0] ?? null;
}

export function draftConversationMessage(input: {
  stage: ConversationStage;
  ctx: ConversationContext;
  replyExcerpt?: string | null;
  problem?: string | null;
  match?: ConversationMatch | null;
  cue?: ConversationCue | null;
  fromStage?: ConversationStage | null;
}): { message: string; goal: string; doNotSay: string[] } {
  const who = firstNameFrom(input.ctx.firstName);
  const problem = painTheyStated(input);
  const capability = input.match?.capability || "custom software and AI automation";
  const bookingUrl = bookingUrlForDraft(input.ctx.channel ?? "LINKEDIN", input.ctx.bookingUrl, {
    publicLeadId: input.ctx.publicLeadId,
    conversationId: input.ctx.conversationId,
  });
  const doNotSay = [
    "Do not pretend to be the operator.",
    "Do not send this message.",
    CONVERSATION_OBJECTIVE.forbid,
    COMMERCIAL_NON_CONSULTING_GUARDRAIL,
    "Do not give away the deliverable even if they asked for it.",
    "If this would not make them more likely to hire your business, do not send it.",
    "Once they book: stop. No follow-up sequence, extra pitch, or just-checking-in.",
    "Do not paste a generic your business brochure.",
    `Do not send ${LINKEDIN_MEETING_HOST} until they show meeting intent.`,
  ];

  if (input.stage === "STOPPED") {
    return { message: "", goal: "Stop. No draft.", doNotSay };
  }

  if (input.stage === "GETTING_TO_KNOW" || input.stage === "CONNECTED") {
    if (input.cue === "problem") {
      return {
        message: `Got you. Hope that gets sorted.`,
        goal: "Acknowledge. Do not force a sales pitch onto an unmatched problem.",
        doNotSay: [...doNotSay, "Do not mention your business, AI, a call, or the booking link."],
      };
    }
    if (input.cue === "casual" || input.cue === "interested" || input.cue === "maybe_later") {
      return {
        message: `Of course! Hope you're having a good week.`,
        goal: "Rapport only. No pitch.",
        doNotSay: [...doNotSay, "Do not mention your business, AI, a call, or the booking link."],
      };
    }
    return {
      message: `Hey ${who}, great to connect. Hope you're having a good week.`,
      goal: "Rapport only. Do not pitch a new connection.",
      doNotSay: [...doNotSay, "Do not mention your business, AI, a call, or the booking link."],
    };
  }

  if (input.stage === "DISCOVERY") {
    return {
      message: `Got you. What's the part that's actually getting in the way?`,
      goal: "One qualifying question only if needed to know whether there is a real opportunity. Do not interview.",
      doNotSay: [...doNotSay, "Do not list tactics, tools, or a 5-step plan.", "Do not manufacture a problem."],
    };
  }

  if (input.stage === "PROBLEM_IDENTIFIED") {
    return {
      message: `Got you. What's the part that's actually getting in the way?`,
      goal: "One qualifying question. Do not pitch. Do not send the booking link.",
      doNotSay,
    };
  }

  if (input.stage === "SOLUTION_MATCH" || input.stage === "PITCH") {
    if (input.cue === "asked_what_you_do" || !input.match?.matched) {
      return {
        message: COMMERCIAL_POSITIONING,
        goal: "They asked what you do. Position your business commercially. Do not invent their pain. No booking link.",
        doNotSay,
      };
    }
    return {
      message: positionOffer(input.match, problem, input.replyExcerpt),
      goal: "Pain maps to one of your services. Position it and offer a call. Do not start solving. No booking link yet.",
      doNotSay,
    };
  }

  if (input.stage === "INTEREST") {
    const askedForMaterials = /\bsend me\b/i.test(input.replyExcerpt || "");
    if (askedForMaterials) {
      return {
        message: problem
          ? `I don't send generic decks. We build ${capability} around that — happier to look at it on a short call if useful.`
          : `I don't send generic decks. Happier to look at the actual situation on a short call if that's useful.`,
        goal: "They asked for materials. Soft convert. No brochure. No booking link unless they asked to talk.",
        doNotSay,
      };
    }
    if (/\btell me more\b/i.test(input.replyExcerpt || "") || input.cue === "asked_what_you_do") {
      return {
        message: COMMERCIAL_POSITIONING,
        goal: "They asked to hear more. Explain your business commercially. Do not manufacture pain. No booking link yet.",
        doNotSay,
      };
    }
    if (input.match?.matched || problem) {
      return {
        message: `Got you. ${capability} is exactly what we build at ${getBusinessProfile().businessName}. If you're looking at fixing that, I'd be happy to walk you through it on a short call.`,
        goal: "They named a relevant problem after the pitch. Move commercially. Do not restart discovery.",
        doNotSay,
      };
    }
    return {
      message: COMMERCIAL_POSITIONING,
      goal: "Interest. Position your business. Still no link unless they asked to talk.",
      doNotSay,
    };
  }

  if (input.stage === "BOOKING_STARTED") {
    return {
      message: problem
        ? `Perfect — grab whatever slot is easiest. I'll come prepared around ${problem}.`
        : `Perfect — grab whatever slot is easiest.`,
      goal: "They started booking. Stop extra chat.",
      doNotSay,
    };
  }

  if (input.stage === "BOOKED" || input.stage === "MEETING_BOOKED" || input.stage === "COMPLETED") {
    return {
      message: problem
        ? `Locked in. I'll come prepared to talk about ${problem}. See you then.`
        : `Locked in. See you then.`,
      goal: "Meeting booked. Confirm once. Stop selling. No follow-up.",
      doNotSay: [...doNotSay, "Do not pitch again. Do not send a follow-up sequence. Do not just check in."],
    };
  }

  if (input.stage === "LINK_SENT" || input.stage === "MEETING_PROPOSED" || input.stage === "MEETING") {
    const alreadySent =
      input.fromStage === "LINK_SENT" ||
      input.fromStage === "MEETING_PROPOSED" ||
      input.fromStage === "BOOKING_STARTED";
    const askedAgain =
      input.cue === "meeting" || input.cue === "asked_for_help" || input.cue === "buying_intent";
    if (alreadySent && !askedAgain) {
      return {
        message: `Whenever you're ready — no rush.`,
        goal: "CTA already sent. Do not keep pushing the booking link.",
        doNotSay,
      };
    }
    const url = bookingUrl || LINKEDIN_MEETING_URL;
    if (input.cue === "buying_intent") {
      return {
        message: `Pricing depends on scope, so I don't quote a fake package number in chat. Happy to walk through typical ranges on a quick call — you can grab a time here: ${url}`,
        goal: "Pricing question. Commercial answer, then the meeting. Do not restart discovery.",
        doNotSay,
      };
    }
    if (input.cue === "asked_for_help") {
      return {
        message: refuseDeliverableAndMeet(input.replyExcerpt || "", input.match, url),
        goal: "They asked for help or the deliverable. Do not give it. Position your business and send the CTA.",
        doNotSay,
      };
    }
    if (input.match?.matched) {
      return {
        message: `Absolutely — that's something we handle at ${getBusinessProfile().businessName}. Let's have a quick call and I can walk you through how we'd approach it. You can grab a time here: ${url}`,
        goal: "Meeting intent plus a matched service. Position and send the tracked LinkedIn CTA.",
        doNotSay,
      };
    }
    return {
      message: `Absolutely. Let's have a quick call and I can walk you through how we'd approach it. You can grab a time here: ${url}`,
      goal: "Meeting-intent. Send the /go/linkedin booking hop as the next step, not a brochure.",
      doNotSay,
    };
  }

  return {
    message: problem
      ? `Great. Send two times that work this week and we'll look at ${problem} together.`
      : `Great. Send two times that work this week and we'll take it from there.`,
    goal: "Get the meeting. Jarvis still does not send.",
    doNotSay,
  };
}

function refuseDeliverableAndMeet(text: string, match: ConversationMatch | null | undefined, url: string) {
  const t = text.toLowerCase();
  if (/\bcode\b|write (the |this )?code/.test(t)) {
    return `Yes, that's within what we do at ${getBusinessProfile().businessName}. We build custom software and automation for businesses. Let's discuss what you need on a quick call: ${url}`;
  }
  if (/ideas/.test(t)) {
    return `Absolutely — that's the kind of work we do at ${getBusinessProfile().businessName}. We can look at what you're trying to achieve and recommend the right approach. Let's discuss it on a quick call: ${url}`;
  }
  if (/\bseo\b/.test(t)) {
    return `That's actually something we handle at ${getBusinessProfile().businessName}. We run SEO as a service for businesses rather than handing over a DIY plan. Let's discuss what you're trying to achieve on a quick call: ${url}`;
  }
  if (/\bai\b/.test(t) && /use|tool|model|which/.test(t)) {
    return `We don't drop a generic tool recommendation in chat — we implement AI around the actual business process. That's the work we do at ${getBusinessProfile().businessName}. Let's discuss it on a quick call: ${url}`;
  }
  if (/automat/.test(t) && /how (should|can|would|do)|ideas/.test(t)) {
    return `That's actually something we build at ${getBusinessProfile().businessName}. We can design and implement the automation around your existing sales process. Rather than trying to map it all out here, let's have a quick call and see what would make sense for your team: ${url}`;
  }
  if (/saas|how (would|do|could) you (build|solve|approach)/.test(t)) {
    return `That's within what we build at ${getBusinessProfile().businessName} — custom software and SaaS products for businesses. Rather than designing it in chat, let's have a quick call and walk through how we'd approach it: ${url}`;
  }
  if (match?.matched || /need someone|can you (build|help)/.test(t)) {
    return `Absolutely — that's something we can help you with at ${getBusinessProfile().businessName}. Let's discuss what you're looking to build on a quick call: ${url}`;
  }
  return `Absolutely — that's something we can help you with at ${getBusinessProfile().businessName}. Let's discuss what you're looking to build on a quick call: ${url}`;
}

function positionOffer(match?: ConversationMatch | null, problem?: string | null, excerpt?: string | null) {
  const blob = `${match?.pain || ""} ${problem || ""} ${excerpt || ""}`;
  if (match?.service === "WEBSITE_DEVELOPMENT") {
    return `Got you. Website performance and rebuilds are actually something we handle at ${getBusinessProfile().businessName}. If you're looking at improving it, I'd be happy to show you what we could do. Want to have a quick call?`;
  }
  if (match?.service === "AI_AUTOMATION" && /lead|follow[- ]?up/i.test(blob)) {
    return `Yeah, that's actually something we help businesses automate at ${getBusinessProfile().businessName}. We build lead-handling and follow-up systems so opportunities don't get lost. If you're open to it, let's have a quick call and see what we could build around your workflow.`;
  }
  if (match?.service === "AI_AUTOMATION") {
    return `Definitely something we handle at ${getBusinessProfile().businessName}. We build AI-powered sales and workflow automation around existing business processes. Happy to discuss what you're looking for on a quick call.`;
  }
  const capability = match?.capability || "custom software, AI systems and automation";
  return `Got you. That's something we handle at ${getBusinessProfile().businessName} — we build ${capability}. If you're looking at improving it, I'd be happy to show you what we could do. Want to have a quick call?`;
}

function painTheyStated(input: {
  replyExcerpt?: string | null;
  problem?: string | null;
  match?: ConversationMatch | null;
}) {
  const spoken = input.replyExcerpt?.replace(/\s+/g, " ").trim() ?? "";
  const looksLikeTheirPain =
    spoken.length > 18 &&
    !/^(interesting|tell me more|what do you|who are you|sure,? let)/i.test(spoken);
  if (looksLikeTheirPain && (input.match?.matched || input.problem)) {
    return spoken.replace(/[.?!]+$/g, "").slice(0, 110);
  }
  if (input.match?.matched) return input.match.pain || input.problem || null;
  return input.problem?.trim() || null;
}

export function assertNoPrematurePitch(stage: ConversationStage, message: string) {
  if (
    stage !== "GETTING_TO_KNOW" &&
    stage !== "DISCOVERY" &&
    stage !== "CONNECTED" &&
    stage !== "PROBLEM_IDENTIFIED"
  ) {
    return;
  }
  if (PREMATURE_PITCH_RE.test(message)) {
    throw new Error("Conversation draft pitched before intent score 3.");
  }
}

export function assertNoPrematureBookingLink(stage: ConversationStage, message: string) {
  if (!message) return;
  if (linkedInCtaAllowedStage(stage)) return;
  if (BOOKING_LINK_RE.test(message)) {
    throw new Error("Conversation draft sent the /go/linkedin booking link before meeting intent.");
  }
}

export function assertNoConsulting(message: string) {
  if (!message) return;
  if (CONSULTING_RE.test(message)) {
    throw new Error("Conversation draft tried to give away the solution in chat.");
  }
}

export function assertNoBrochure(message: string) {
  if (!message) return;
  if (BROCHURE_RE.test(message)) {
    throw new Error("Conversation draft used a generic your business brochure instead of the exact problem.");
  }
}

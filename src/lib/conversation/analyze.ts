import { conversationHeatFrom } from "@/lib/conversation/heat";
import { scoreBuyingIntent } from "@/lib/conversation/intent";
import { matchConversationPain } from "@/lib/conversation/match";
import { emptyWhyNow, type ConversationAnalysis, type ConversationCue, type ConversationMatch, type WhyNowSignals } from "@/lib/conversation/types";
import { detectWhyNow } from "@/lib/conversation/why-now";

const DNC_RE = /\b(unsubscribe|stop (emailing|messaging|contacting)|remove me|opt[- ]?out|do not contact|don't contact)\b/i;
const DECLINE_RE = /\b(not interested|no thanks|no thank you|we're (all )?set|we are (all )?set|please don'?t|not a fit)\b/i;
const BOOKED_RE = /\b(calendly|booked|see you (then|on)|thursday works|tuesday works|let'?s do \w+day|i('ll| will) send (a )?time)\b/i;
const BOOKING_STARTED_RE = /\b(just (opened|grabbed) (a |the )?(link|slot)|starting to book|on the (booking|calendar) page)\b/i;
const MEETING_RE =
  /\b(let'?s talk|let us talk|sure,? let'?s (talk|discuss)|book a (call|meeting)|schedule( something)?|available (to )?chat|jump on a call|set up a (call|meeting)|can we have a (call|chat|meeting)|can you show me|let'?s schedule)\b/i;
const DISCUSS_RE =
  /\b((yeah,? )?i('d| would) be interested|i'?d like to discuss|like to discuss (it|this)|how can we work together|how (would|do) we work together)\b/i;
const ASK_WHAT_RE =
  /\b(what do you (do|guys do|offer)|what does (?:your company|[a-z0-9 .&'-]{2,40}) do|what services do you( guys)? offer|show me what you (guys )?do|tell me about (you|your (company|work|services))|who are you( guys)?|what (is|are) zar labs)\b/i;
const ASK_HOW_RE =
  /\bhow (would|do|could) you (build|solve|approach|do|implement|automate|design|write)\b/i;
const ASK_HELP_RE = /\b(can you help|could you help|we need (help|someone)|looking for (someone|an agency|help)|build (this|it|one) for us|can you (build|do) (this|that|it))\b/i;
const ASK_DELIVERABLE_RE =
  /\b((give|share) me (some )?ideas|can you (give|share) (me )?(some )?ideas|ideas for (my |our |the )?(website|site|business|app)|how should i\b|how (can|do) i (improve|automate|build|fix|implement)|can you write (the |this |some )?code|write (the |this )?code|what (ai|tool|tools|model|stack|platform) should i|which (ai|tool|model|stack) should i|recommend (a |an |some )?(tool|stack|platform|ai|model)|debug (this|my|the)|brainstorm|step[- ]by[- ]step (plan|guide|implementation)|how (would|do|could|should) (i|we) (automate|improve|build|implement|design)|architecture for|implementation (plan|for)|technical roadmap)\b/i;
const BUYING_RE = /\b(how much|pricing|quote|proposal|what would it (cost|take)|we'?d (hire|pay)|ready to (start|move))\b/i;
const INTEREST_RE = /\b(interested|sounds good|this is relevant|that could help|that'?s (exactly |right )?what we need|tell me more|interesting|send me (something|more|info|details|a (deck|one[- ]pager)|materials))\b/i;
const MAYBE_RE = /\b(maybe (sometime|later)|not right now|down the road)\b/i;
const PROBLEM_RE =
  /\b(struggling|struggle|hectic|overwhelmed|keep(ing)? up|bottleneck|too (much|many)|manual|inefficien|can'?t scale|behind on|bandwidth|headache|difficult|doesn'?t convert|isn'?t ready|isn't great)\b/i;

export function analyzeConversationReply(text: string): ConversationAnalysis {
  const body = text.trim();
  const match = matchConversationPain(body);
  const whyNow = detectWhyNow(body);
  if (!body) {
    return finish("no_reply", {
      signal: null,
      problem: null,
      match: matchConversationPain(""),
      whyNow: emptyWhyNow(),
      text: "",
      pitchAllowed: false,
      doNotPitch: true,
      summary: "No reply. Wait. Do not pitch a cold connection.",
    });
  }
  if (DNC_RE.test(body)) {
    return finish("dnc", {
      signal: "opt_out",
      problem: null,
      match,
      whyNow,
      text: body,
      pitchAllowed: false,
      doNotPitch: true,
      summary: "They asked not to be contacted. Stop immediately.",
    });
  }
  if (DECLINE_RE.test(body)) {
    return finish("decline", {
      signal: "not_interested",
      problem: null,
      match,
      whyNow,
      text: body,
      pitchAllowed: false,
      doNotPitch: true,
      summary: "They said no. Stop. Do not keep selling.",
    });
  }
  if (BOOKED_RE.test(body)) {
    return finish("booked", {
      signal: "meeting_booked",
      problem: match.pain,
      match,
      whyNow,
      text: body,
      pitchAllowed: true,
      doNotPitch: false,
      summary: "They confirmed a time. Stop chatting. Confirm the meeting.",
    });
  }
  if (BOOKING_STARTED_RE.test(body)) {
    return finish("booking_started", {
      signal: "booking_started",
      problem: match.pain,
      match,
      whyNow,
      text: body,
      pitchAllowed: true,
      doNotPitch: false,
      summary: "They started booking. Stop extra conversation.",
    });
  }
  if (MEETING_RE.test(body)) {
    return finish("meeting", {
      signal: "asked_to_talk",
      problem: match.pain,
      match,
      whyNow,
      text: body,
      pitchAllowed: true,
      doNotPitch: false,
      summary: "They said let's talk. Switch to booking. Do not keep chatting.",
    });
  }
  if (DISCUSS_RE.test(body)) {
    return finish("meeting", {
      signal: "asked_to_talk",
      problem: match.pain,
      match,
      whyNow,
      text: body,
      pitchAllowed: true,
      doNotPitch: false,
      summary: "They want to talk. Send the tracked LinkedIn booking link. Do not keep chatting.",
    });
  }
  if (MAYBE_RE.test(body)) {
    return finish("maybe_later", {
      signal: "soft_interest",
      problem: match.pain,
      match,
      whyNow,
      text: body,
      pitchAllowed: false,
      doNotPitch: true,
      summary: "Maybe later. Keep them warm. Do not push a pitch.",
    });
  }
  if (ASK_HOW_RE.test(body) || ASK_HELP_RE.test(body) || ASK_DELIVERABLE_RE.test(body)) {
    return finish("asked_for_help", {
      signal: "asked_for_help",
      problem: match.pain ?? clipProblem(body),
      match,
      whyNow,
      text: body,
      pitchAllowed: true,
      doNotPitch: false,
      summary: isAskingForDeliverable(body)
        ? "They asked for the deliverable. Do not give it. Position your business and send the meeting CTA."
        : "They want someone to do the work. Send the tracked LinkedIn meeting link.",
    });
  }
  if (ASK_WHAT_RE.test(body)) {
    return finish("asked_what_you_do", {
      signal: "invited_pitch",
      problem: match.pain,
      match,
      whyNow,
      text: body,
      pitchAllowed: true,
      doNotPitch: false,
      summary: "They asked what you do. Position your business. Do not dump the booking link yet.",
    });
  }
  if (BUYING_RE.test(body)) {
    return finish("buying_intent", {
      signal: "buying_intent",
      problem: match.pain,
      match,
      whyNow,
      text: body,
      pitchAllowed: true,
      doNotPitch: false,
      summary: "Pricing / commercial question. Push toward a meeting. Do not keep discovering.",
    });
  }
  if (PROBLEM_RE.test(body) || match.strength !== "none") {
    return finish("problem", {
      signal: match.buyingSignal ? "buying_signal" : match.matched ? "pain_no_intent" : "vague_ops",
      problem: match.pain ?? clipProblem(body),
      match,
      whyNow,
      text: body,
      pitchAllowed: false,
      doNotPitch: true,
      summary: "Problem mentioned. Intent score decides whether to qualify or pitch.",
    });
  }
  if (INTEREST_RE.test(body)) {
    return finish("interested", {
      signal: "showed_interest",
      problem: match.pain,
      match,
      whyNow,
      text: body,
      pitchAllowed: false,
      doNotPitch: true,
      summary: "They showed interest. Intent score decides whether that is engagement or a meeting push.",
    });
  }
  return finish("casual", {
    signal: "casual_reply",
    problem: null,
    match,
    whyNow,
    text: body,
    pitchAllowed: false,
    doNotPitch: true,
    summary: "Casual conversation. Stay natural.",
  });
}

function finish(
  cue: ConversationCue,
  rest: {
    signal: string | null;
    problem: string | null;
    match: ConversationMatch;
    whyNow: WhyNowSignals;
    text: string;
    pitchAllowed: boolean;
    doNotPitch: boolean;
    summary: string;
  },
): ConversationAnalysis {
  const scored = scoreBuyingIntent({ cue, match: rest.match, whyNow: rest.whyNow, text: rest.text });
  const heat = conversationHeatFrom({ score: scored.score, cue });
  const pitchAllowed = scored.score >= 3 && cue !== "dnc" && cue !== "decline" && cue !== "maybe_later";
  return {
    cue,
    matchesOffer: rest.match.matched,
    signal: rest.signal,
    problem: rest.problem,
    match: rest.match,
    whyNow: rest.whyNow,
    intentScore: scored.score,
    intentReason: scored.reason,
    heat,
    pitchAllowed,
    doNotPitch: !pitchAllowed,
    summary: rest.summary === "Problem mentioned. Intent score decides whether to qualify or pitch." ? scored.reason : rest.summary,
    text: rest.text,
  };
}

function clipProblem(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function isAskingForDeliverable(text: string) {
  return ASK_HOW_RE.test(text) || ASK_DELIVERABLE_RE.test(text);
}

export function shouldStopLinkedInOnReply(cue: ConversationCue) {
  return cue === "dnc" || cue === "decline";
}

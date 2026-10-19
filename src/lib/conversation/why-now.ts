import { emptyWhyNow, type WhyNowSignals } from "@/lib/conversation/types";

const TIMELINE_RE =
  /\b(next (week|month|quarter)|this (week|month|quarter)|by (friday|monday|eom|end of (the )?month)|in \d+ (days|weeks|months)|q[1-4])\b/i;
const URGENCY_RE = /\b(asap|urgent|right away|need(s|ed)? (it )?now|isn't ready|not ready|behind schedule)\b/i;
const BUDGET_RE = /\b(budget|we('ve| have) (money|budget)|allocated|can pay|priced in)\b/i;
const PROJECT_RE = /\b(rebuild(ing)?|in the middle of|already started|active project|kicking off)\b/i;
const GROWTH_RE = /\b(growing (pretty |really )?(quickly|fast)|growth spurt|scaled? (up|fast))\b/i;
const HIRING_RE = /\b(hiring|we're recruiting|open role|need to hire)\b/i;
const LAUNCH_RE = /\b(launch(ing|es)?|go[- ]live|new service|new product|shipping next)\b/i;
const FUNDRAISE_CLEAN = /\b(raising (a |our )?(round|seed)|seed round|series [a-c]|we (just )?raised)\b/i;
const EXPANSION_RE = /\b(expand(ing|s)?|new market|opening (an? )?office|second location)\b/i;

export function detectWhyNow(text: string): WhyNowSignals {
  const body = text.trim();
  const signals = emptyWhyNow();
  if (!body) return signals;
  const timeline = body.match(TIMELINE_RE)?.[0] ?? null;
  signals.timeline = timeline ? timeline.replace(/\s+/g, " ") : null;
  signals.urgency = URGENCY_RE.test(body) || Boolean(timeline);
  signals.budget_signal = BUDGET_RE.test(body);
  signals.active_project = PROJECT_RE.test(body);
  signals.growth_event = GROWTH_RE.test(body);
  signals.hiring = HIRING_RE.test(body);
  signals.launch = LAUNCH_RE.test(body);
  signals.fundraising = FUNDRAISE_CLEAN.test(body);
  signals.expansion = EXPANSION_RE.test(body);
  return signals;
}

export function whyNowReasons(signals: WhyNowSignals) {
  const reasons: string[] = [];
  if (signals.launch) reasons.push("launch");
  if (signals.timeline) reasons.push(`timeline: ${signals.timeline}`);
  if (signals.urgency) reasons.push("urgency");
  if (signals.budget_signal) reasons.push("budget");
  if (signals.active_project) reasons.push("active project");
  if (signals.growth_event) reasons.push("growth");
  if (signals.hiring) reasons.push("hiring");
  if (signals.fundraising) reasons.push("fundraising");
  if (signals.expansion) reasons.push("expansion");
  return reasons;
}

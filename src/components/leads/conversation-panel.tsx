import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

const STAGES = [
  "CONNECTED",
  "GETTING_TO_KNOW",
  "DISCOVERY",
  "PROBLEM_IDENTIFIED",
  "SOLUTION_MATCH",
  "PITCH",
  "INTEREST",
  "MEETING_PROPOSED",
  "LINK_SENT",
  "BOOKING_STARTED",
  "MEETING_BOOKED",
] as const;

function analysisView(analysis: unknown) {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
    return { matchLabel: null as string | null, intentScore: null as number | null, heat: null as string | null, whyNow: [] as string[] };
  }
  const row = analysis as {
    match?: { serviceLabel?: string | null };
    intentScore?: number;
    heat?: string;
    whyNow?: Record<string, boolean | string | null>;
  };
  const whyNow = Object.entries(row.whyNow ?? {})
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => (typeof value === "string" ? `${key}: ${value}` : key.replaceAll("_", " ")));
  return {
    matchLabel: row.match?.serviceLabel ?? null,
    intentScore: typeof row.intentScore === "number" ? row.intentScore : null,
    heat: row.heat ?? null,
    whyNow,
  };
}

export function ConversationPanel({
  stage,
  signal,
  problem,
  pitchAllowed,
  summary,
  stopped,
  stopReason,
  suggestedMessage,
  matchLabel,
  analysis,
  intentScore,
  heat,
  meetingSource,
  meetingEntryUrl,
  linkSentAt,
  ctaClickedAt,
  bookedAt,
  socialAutomation = false,
}: {
  stage?: string | null;
  signal?: string | null;
  problem?: string | null;
  pitchAllowed?: boolean;
  summary?: string | null;
  stopped?: boolean;
  stopReason?: string | null;
  suggestedMessage?: string | null;
  matchLabel?: string | null;
  analysis?: unknown;
  intentScore?: number | null;
  heat?: string | null;
  meetingSource?: string | null;
  meetingEntryUrl?: string | null;
  linkSentAt?: Date | string | null;
  ctaClickedAt?: Date | string | null;
  bookedAt?: Date | string | null;
  socialAutomation?: boolean;
}) {
  const current =
    stopped
      ? "STOPPED"
      : stage === "SOLUTION_RELEVANT"
        ? "SOLUTION_MATCH"
        : stage === "SOFT_PITCH"
          ? "PITCH"
          : stage === "MEETING"
            ? "MEETING_PROPOSED"
            : stage === "BOOKED"
              ? "MEETING_BOOKED"
              : stage || "NONE";
  const parsed = analysisView(analysis);
  const zarMatch = matchLabel || parsed.matchLabel;
  const score = intentScore ?? parsed.intentScore;
  const convoHeat = heat || parsed.heat;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        KPI is qualified conversations → meetings → clients.
        {socialAutomation
          ? " The LinkedIn booking link is /go/linkedin — only after meeting intent. When LinkedIn Daily Outreach is ON, Jarvis sends via your authenticated Chrome session."
          : " Email is the send channel. LinkedIn and Instagram notes stay for you to send by hand."}
      </p>
      <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300">
        <p className="font-medium text-zinc-100">Before you approve a draft, ask:</p>
        <p className="mt-1">If I were the prospect, does this make me more likely to hire your business?</p>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-muted">
          <li>Teaches them to do the work themselves → reject</li>
          <li>Invents a problem → reject</li>
          <li>Asks unnecessary questions → reject</li>
          <li>Already interested but still chatting → reject</li>
        </ul>
        {current === "MEETING_BOOKED" || bookedAt ? (
          <p className="mt-2 text-emerald-300">Meeting booked. Outreach stops. No follow-up, extra pitch, or checking in.</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {STAGES.map((item) => (
          <Badge key={item} tone={item === current ? "default" : "muted"}>
            {item.replaceAll("_", " ")}
          </Badge>
        ))}
        {current === "STOPPED" ? <Badge tone="DISQUALIFIED">STOPPED</Badge> : null}
      </div>
      <p>
        Buying intent: <strong>{score ?? 0}/5</strong>
        {convoHeat ? ` · Heat ${convoHeat}` : ""}
        {pitchAllowed ? " · pitch allowed" : " · no pitch yet"}
      </p>
      {signal ? <p>Signal: {signal.replaceAll("_", " ")}</p> : null}
      {problem ? <p>Pain: {problem}</p> : null}
      {zarMatch ? <p>your business match: {zarMatch}</p> : null}
      {parsed.whyNow.length ? <p>Why now: {parsed.whyNow.join(", ")}</p> : null}
      {meetingSource && meetingSource !== "UNKNOWN" ? (
        <p>
          Meeting source: {meetingSource}
          {meetingEntryUrl ? ` · ${meetingEntryUrl.replace(/^https:\/\//, "")}` : ""}
          {meetingEntryUrl?.includes("source=linkedin") ? " · source=linkedin survived" : ""}
        </p>
      ) : null}
      {linkSentAt || ctaClickedAt || bookedAt ? (
        <p className="text-muted">
          {linkSentAt ? `Link sent ${formatDate(linkSentAt)}` : "Link not sent"}
          {ctaClickedAt ? ` · CTA clicked ${formatDate(ctaClickedAt)}` : ""}
          {bookedAt ? ` · Booked ${formatDate(bookedAt)}` : ""}
        </p>
      ) : null}
      {summary ? <p className="text-muted">{summary}</p> : null}
      {suggestedMessage ? (
        <div>
          <p className="text-xs uppercase tracking-wider text-muted">Suggested next message (not sent)</p>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-zinc-200">{suggestedMessage}</pre>
        </div>
      ) : null}
      {stopped ? <p className="text-rose-300">Stopped{stopReason ? `: ${stopReason}` : "."}</p> : null}
    </div>
  );
}

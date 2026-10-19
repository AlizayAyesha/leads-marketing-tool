import { Badge } from "@/components/ui/badge";

const CHECKS = [
  { key: "email", label: "Email" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "instagram", label: "Instagram" },
  { key: "serviceNeed", label: "Service need" },
] as const;

type CheckView = {
  status?: string;
  summary?: string;
  issues?: string[];
  seniority?: string;
  presence?: string;
};

export function DecisionPanel({
  verdict,
  professionalStatus,
  emailStatus,
  linkedinStatus,
  linkedinSeniority,
  instagramStatus,
  instagramPresence,
  serviceNeedStatus,
  allowedChannels,
  summary,
  blockers,
  unknowns,
  recommendedAction,
  checks,
  mode,
}: {
  verdict: string;
  professionalStatus?: string | null;
  emailStatus?: string | null;
  linkedinStatus?: string | null;
  linkedinSeniority?: string | null;
  instagramStatus?: string | null;
  instagramPresence?: string | null;
  serviceNeedStatus?: string | null;
  allowedChannels?: unknown;
  summary?: string | null;
  blockers?: unknown;
  unknowns?: unknown;
  recommendedAction?: string | null;
  checks?: unknown;
  mode?: string | null;
}) {
  const channels = Array.isArray(allowedChannels) ? allowedChannels.map(String) : [];
  const blockList = Array.isArray(blockers) ? blockers.map(String) : [];
  const unknownList = Array.isArray(unknowns) ? unknowns.map(String) : [];
  const checkMap = (checks ?? {}) as Record<string, CheckView>;
  const tone = verdict === "PASS" ? "default" : verdict === "HOLD" ? "WARM" : "DISQUALIFIED";

  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted">Decision maker</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{verdict}</Badge>
        {professionalStatus ? <Badge tone="muted">{professionalStatus}</Badge> : null}
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <Row label="Email" value={emailStatus} />
        <Row
          label="LinkedIn"
          value={[linkedinStatus, linkedinSeniority && linkedinSeniority !== "not_present" ? linkedinSeniority : null]
            .filter(Boolean)
            .join(" · ")}
        />
        <Row
          label="Instagram"
          value={[instagramStatus, instagramPresence && instagramPresence !== "not_present" ? instagramPresence : null]
            .filter(Boolean)
            .join(" · ")}
        />
        <Row label="Needs our services" value={serviceNeedStatus} />
        <Row label="Allowed channels" value={channels.join(", ") || "None"} />
      </dl>
      <div className="mt-4 space-y-2">
        {CHECKS.map((item) => {
          const check = checkMap[item.key];
          if (!check?.summary) return null;
          return (
            <p key={item.key} className="text-xs text-muted">
              <span className="text-zinc-300">{item.label}: </span>
              {check.summary}
            </p>
          );
        })}
      </div>
      {recommendedAction ? (
        <p className="mt-4 text-sm">
          <span className="text-muted">Next: </span>
          {recommendedAction}
        </p>
      ) : null}
      {summary ? <p className="mt-2 text-sm text-muted">{summary}</p> : null}
      {unknownList.length ? (
        <p className="mt-3 text-xs text-amber-200">Unknown: {unknownList.join(" ")}</p>
      ) : null}
      {blockList.length ? (
        <p className="mt-2 text-xs text-rose-200">Blockers: {blockList.join(" ")}</p>
      ) : null}
      {mode ? <p className="mt-3 text-xs uppercase tracking-wider text-muted">Mode · {mode}</p> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-zinc-200">{value || "—"}</dd>
    </div>
  );
}

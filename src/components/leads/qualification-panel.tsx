import { explainQualification } from "@/lib/intelligence/explain";
import type { LeadTemperature } from "@prisma/client";

const BARS: { key: "fit" | "need" | "intent" | "timing" | "access"; label: string; max: number }[] = [
  { key: "fit", label: "FIT", max: 25 },
  { key: "need", label: "NEED", max: 25 },
  { key: "intent", label: "INTENT", max: 20 },
  { key: "timing", label: "TIMING", max: 15 },
  { key: "access", label: "ACCESS", max: 15 },
];

export function QualificationPanel({
  score,
  reason,
  temperature,
  breakdown,
  evidenceUsed,
  mode,
}: {
  score: number;
  reason?: string | null;
  temperature?: LeadTemperature | null;
  breakdown?: unknown;
  evidenceUsed?: unknown;
  mode?: string | null;
}) {
  const view = explainQualification({ score, reason, temperature, breakdown, evidenceUsed });
  const hasBars = BARS.every((bar) => view[bar.key] != null);

  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted">Qualification</p>
      <p className="font-[family-name:var(--font-syne)] text-4xl text-emerald-200">
        {view.score}
        <span className="text-lg text-muted">/100</span>
      </p>
      {hasBars ? (
        <div className="mt-4 space-y-2">
          {BARS.map((bar) => {
            const value = view[bar.key] ?? 0;
            return (
              <div key={bar.key}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted">{bar.label}</span>
                  <span>
                    {value}/{bar.max}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-emerald-400/80"
                    style={{ width: `${Math.round((value / bar.max) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <section className="mt-4 space-y-2 text-sm">
        <List title="Evidence" items={view.evidence} tone="emerald" />
        <List title="Unknown" items={view.unknowns} tone="amber" />
        <List title="Risk" items={view.risks.length ? [`${view.riskLevel}`, ...view.risks] : [view.riskLevel]} />
      </section>

      <p className="mt-4 text-sm">
        <span className="text-muted">Recommended action: </span>
        {view.recommendedAction}
      </p>
      {view.reason ? <p className="mt-2 text-sm text-muted">{view.reason}</p> : null}
      {mode ? <p className="mt-3 text-xs uppercase tracking-wider text-muted">Mode · {mode}</p> : null}
    </div>
  );
}

function List({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone?: "emerald" | "amber";
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.length === 0 ? <li className="text-muted">None recorded</li> : null}
        {items.map((item) => (
          <li
            key={item}
            className={tone === "emerald" ? "text-emerald-100/90" : tone === "amber" ? "text-amber-100/90" : ""}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

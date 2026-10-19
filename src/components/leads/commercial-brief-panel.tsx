import type { CommercialBrief } from "@/lib/intelligence/commercial";

export function CommercialBriefPanel({ brief }: { brief: CommercialBrief }) {
  const priority = brief.selection === "PRIORITY";
  return (
    <section className="mb-6 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-5">
      <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-400/80">
        {priority ? "Priority opportunity" : brief.selection === "NURTURE" ? "Nurture" : "Rejected"}
      </p>
      <p className="mt-1 font-[family-name:var(--font-syne)] text-3xl text-emerald-100">
        {brief.buyNowScore}
        <span className="text-lg text-muted"> /100 BUY_NOW</span>
      </p>
      <p className="mt-1 text-xs text-muted">
        Score ranks. It cannot create eligibility. Trigger {brief.triggerFreshness}
        {brief.triggerAgeDays != null ? ` · ${brief.triggerAgeDays} days old` : ""}.
      </p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Item label="ICP" value={brief.icpLabel ?? "Not a named ICP"} />
        <Item label="Model" value={brief.businessModel} />
        <Item label="Decision maker" value={brief.decisionMakerRole} />
        <Item label="DM confidence" value={`${brief.decisionMakerConfidence}%`} />
      </dl>
      {brief.whyPrioritized ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
          <p className="text-[11px] uppercase tracking-wider text-emerald-300">Why this lead?</p>
          <p className="mt-2">Why now: {brief.whyPrioritized.whyNow}</p>
          <p className="mt-1">Observed problem: {brief.whyPrioritized.observedProblem}</p>
          <p className="mt-1">Opportunity: {brief.whyPrioritized.opportunity}</p>
          <p className="mt-1">Recommended offer: {brief.whyPrioritized.recommendedOffer}</p>
          <p className="mt-1">Buyer: {brief.whyPrioritized.buyer}</p>
          {brief.whyPrioritized.evidenceUrl ? (
            <p className="mt-1 text-xs text-muted">
              Evidence: {brief.whyPrioritized.evidenceSnippet}{" "}
              <a className="text-emerald-300 underline" href={brief.whyPrioritized.evidenceUrl} target="_blank" rel="noreferrer">
                source
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <Layer title="FACT" items={brief.layers.facts} />
        <Layer title="INFERENCE" items={brief.layers.inferences} />
        <Layer title="UNKNOWN" items={brief.layers.unknowns} />
        <Block title="RECOMMENDATION" body={brief.layers.recommendation} />
      </div>
      <Block title="Why Now" body={brief.whyNow} />
      <Block title="Why your business" body={brief.whyUs} />
      <Block title="Recommended CTA" body={brief.recommendedCTA} />
      <p className="mt-3 text-xs text-muted">
        Research confidence {brief.researchConfidence}%. Ability-to-pay is informational ({brief.abilityToPay}/15) and does not unlock send.
      </p>
    </section>
  );
}

function Item({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1 text-white">{value || "—"}</dd>
    </div>
  );
}

function Block({ title, body }: { title: string; body?: string | null }) {
  return (
    <div className="mt-4">
      <p className="text-[11px] uppercase tracking-wider text-muted">{title}</p>
      <p className="mt-1 text-sm text-zinc-200">{body || "Not evidenced yet."}</p>
    </div>
  );
}

function Layer({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-zinc-200">
        {items.length ? items.map((item) => <li key={item}>{item}</li>) : <li>None recorded.</li>}
      </ul>
    </div>
  );
}

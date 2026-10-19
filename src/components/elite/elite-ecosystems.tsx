"use client";

import { useEffect, useState } from "react";

import { runEliteExperimentAction } from "@/lib/actions/elite";
import {
  ELITE_ECOSYSTEMS,
  ELITE_LAYER1_SOURCES,
  ELITE_SCORE_BANDS,
  ELITE_TARGET_ROLES,
  FIRST_ELITE_EXPERIMENT,
  type EliteEcosystemId,
} from "@/lib/elite/catalog";
import { Button } from "@/components/ui/button";
import { TaskRunBanner, useTaskRun } from "@/components/ui/task-run-status";

type ExperimentSummary = {
  market: string;
  scored: number;
  bands: { priority: number; qualified: number; review: number; reject: number };
  sourceRuns: Array<{ source: string; ok: boolean; detail: string }>;
  notes: string[];
  pipelineQueued: number;
  send: string;
  at?: string;
  sheet?: { ok: boolean; message: string; url?: string | null; appended?: number; sentMarked?: number } | null;
  pitches?: Array<{
    company: string | null;
    offer: string;
    secondary: string | null;
    pitch: string;
    total: number;
    band: string;
  }>;
};

function summaryLines(report: ExperimentSummary) {
  return [
    `Dubai experiment scored ${report.scored} companies.`,
    `Priority ${report.bands.priority} · Qualified ${report.bands.qualified} · Review ${report.bands.review} · Reject ${report.bands.reject}.`,
    `Research queued for ${report.pipelineQueued} priority leads. ${report.send}`,
    ...(report.pitches ?? []).slice(0, 12).map(
      (pitch) => `${pitch.company ?? "Company"} → ${pitch.pitch} (${pitch.band} ${pitch.total})`,
    ),
    ...(report.sourceRuns ?? []).map((run) => `${run.source}: ${run.detail}`),
    ...(report.notes ?? []),
    report.at ? `Finished ${report.at}` : "",
  ].filter(Boolean);
}

export function EliteEcosystemsPanel({ last }: { last?: ExperimentSummary | null }) {
  const [selected, setSelected] = useState<EliteEcosystemId>(FIRST_ELITE_EXPERIMENT.ecosystemIds[0]);
  const [mounted, setMounted] = useState(false);
  const task = useTaskRun();
  const eco = ELITE_ECOSYSTEMS.find((item) => item.id === selected) ?? ELITE_ECOSYSTEMS[0];

  useEffect(() => {
    setMounted(true);
  }, []);

  const showLastDone = mounted && task.phase === "idle" && Boolean(last?.sheet?.ok);

  return (
    <section className="mb-8 rounded-2xl border border-emerald-400/25 bg-emerald-500/5 p-5">
      <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-400/80">Global elite ecosystems</p>
      <h2 className="mt-1 font-[family-name:var(--font-syne)] text-lg text-white">Company first, then the decision maker</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Find the business, then the founder/CEO/MD inside it. Jarvis scores high-value markets and technology
        gaps — not “this person is rich.” Jarvis matches one your business offer: graphics/branding, web development,
        automation, AI architecture, or AI ads/UGC video. First experiment is Dubai + private aviation + luxury real estate + yacht
        (cap {FIRST_ELITE_EXPERIMENT.cap}). Kill switch and draft-only stay on. You still approve before send.
        Done shows only after Jarvis writes new companies to your Google Leads tab and marks already-sent people as SENT.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {ELITE_ECOSYSTEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelected(item.id)}
            className={`rounded-xl border px-3 py-3 text-left text-sm ${
              selected === item.id
                ? "border-emerald-400/50 bg-emerald-500/15 text-white"
                : "border-white/10 bg-black/20 text-emerald-50 hover:border-emerald-400/30"
            }`}
          >
            <span className="mr-2">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted">Market</p>
          <p className="mt-1 text-white">{FIRST_ELITE_EXPERIMENT.market}</p>
        </div>
        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted">Category</p>
          <p className="mt-1 text-white">{eco.category}</p>
        </div>
        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted">Search sources</p>
          <ul className="mt-1 space-y-1 text-xs text-emerald-100">
            {ELITE_LAYER1_SOURCES.slice(0, 5).map((source) => (
              <li key={source.id}>✓ {source.label}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-white/10 p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted">Target roles</p>
          <p className="mt-1 text-xs text-emerald-100">{ELITE_TARGET_ROLES.join(" · ")}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">
        Lead score: {ELITE_SCORE_BANDS.map((band) => `${band.min}–${band.max} ${band.label}`).join(" · ")}. Pipeline:
        Discover → Verify → Research → Score → Decision Maker → Draft → you approve → send.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={task.pending}
          onClick={() =>
            task.run(async () => {
              const report = await runEliteExperimentAction();
              return summaryLines(report);
            })
          }
        >
          {task.pending ? "Running…" : "Run Dubai experiment"}
        </Button>
      </div>
      <TaskRunBanner
        phase={showLastDone ? "done" : task.phase}
        lines={showLastDone && last ? summaryLines(last) : task.lines}
      />
    </section>
  );
}

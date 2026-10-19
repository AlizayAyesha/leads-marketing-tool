"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

export type TaskPhase = "idle" | "running" | "done" | "failed";

export function TaskRunBanner({
  phase,
  lines,
}: {
  phase: TaskPhase;
  lines?: string[] | null;
}) {
  if (phase === "idle") return null;
  if (phase === "running") {
    return (
      <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-50" aria-live="polite" suppressHydrationWarning>
        <p className="text-[11px] font-medium uppercase tracking-wider">Running</p>
        <p className="mt-1">Task is in progress. Keep this tab open until it finishes.</p>
      </div>
    );
  }
  if (phase === "failed") {
    return (
      <div className="mt-4 rounded-xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-50" aria-live="assertive" suppressHydrationWarning>
        <p className="text-[11px] font-medium uppercase tracking-wider">Failed</p>
        {lines?.length ? (
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {lines.map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1">The task stopped with an error.</p>
        )}
      </div>
    );
  }
  return (
    <div
      className="mt-4 rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-4 py-3 text-sm text-emerald-50"
      aria-live="polite"
      data-task-status="done"
      suppressHydrationWarning
    >
      <p className="text-base font-semibold tracking-wide text-emerald-200">Done ✓</p>
      {lines?.length ? (
        <ul className="mt-1 list-disc space-y-1 pl-4 text-emerald-100">
          {lines.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1">Finished.</p>
      )}
    </div>
  );
}

export function useTaskRun(persistKey?: string) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<TaskPhase>("idle");
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    if (!persistKey) return;
    try {
      const raw = sessionStorage.getItem(`task-run:${persistKey}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { phase: TaskPhase; lines: string[] | null };
      if (parsed.phase === "done" || parsed.phase === "failed") {
        setPhase(parsed.phase);
        setLines(parsed.lines);
      }
    } catch {
      /* ignore */
    }
  }, [persistKey]);

  useEffect(() => {
    if (!persistKey) return;
    if (phase === "done" || phase === "failed") {
      sessionStorage.setItem(`task-run:${persistKey}`, JSON.stringify({ phase, lines }));
    }
  }, [persistKey, phase, lines]);

  function run(fn: () => Promise<string[] | string | void>) {
    setBusy(true);
    setPhase("running");
    setLines(null);
    start(async () => {
      try {
        const result = await fn();
        const next = Array.isArray(result) ? result : result ? [result] : ["Finished."];
        setLines(next);
        setPhase("done");
      } catch (error) {
        setLines([error instanceof Error ? error.message : "The task failed."]);
        setPhase("failed");
      } finally {
        setBusy(false);
        window.setTimeout(() => router.refresh(), 50);
      }
    });
  }

  return {
    phase,
    pending: busy || phase === "running",
    lines,
    run,
  };
}

export function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return children;
}

export function FormSubmitStatus({ doneLine }: { doneLine: string }) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  const [phase, setPhase] = useState<TaskPhase>("idle");

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      setPhase("running");
      return;
    }
    if (wasPending.current) {
      wasPending.current = false;
      setPhase("done");
    }
  }, [pending]);

  return <TaskRunBanner phase={phase} lines={phase === "done" ? [doneLine] : null} />;
}

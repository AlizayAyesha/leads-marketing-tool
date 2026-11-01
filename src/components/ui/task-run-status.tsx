"use client";

import { useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
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

function subscribeClient() {
  return () => {};
}

function getClientMounted() {
  return true;
}

function getServerMounted() {
  return false;
}

function readPersistedTask(persistKey?: string) {
  if (!persistKey || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`task-run:${persistKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { phase: TaskPhase; lines: string[] | null };
    if (parsed.phase === "done" || parsed.phase === "failed") return raw;
  } catch {
    /* ignore */
  }
  return null;
}

function parsePersistedTask(raw: string | null): { phase: TaskPhase; lines: string[] | null } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { phase: TaskPhase; lines: string[] | null };
    if (parsed.phase === "done" || parsed.phase === "failed") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function useTaskRun(persistKey?: string) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState<{ phase: TaskPhase; lines: string[] | null } | null>(null);
  const persistedRaw = useSyncExternalStore(
    subscribeClient,
    () => readPersistedTask(persistKey),
    () => null,
  );
  const persisted = parsePersistedTask(persistedRaw);
  const phase = override?.phase ?? persisted?.phase ?? "idle";
  const lines = override ? override.lines : (persisted?.lines ?? null);

  useEffect(() => {
    if (!persistKey || !override) return;
    if (override.phase === "done" || override.phase === "failed") {
      sessionStorage.setItem(`task-run:${persistKey}`, JSON.stringify(override));
    }
  }, [persistKey, override]);

  function run(fn: () => Promise<string[] | string | void>) {
    setBusy(true);
    setOverride({ phase: "running", lines: null });
    start(async () => {
      try {
        const result = await fn();
        const next = Array.isArray(result) ? result : result ? [result] : ["Finished."];
        setOverride({ phase: "done", lines: next });
      } catch (error) {
        setOverride({
          phase: "failed",
          lines: [error instanceof Error ? error.message : "The task failed."],
        });
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
  const mounted = useSyncExternalStore(subscribeClient, getClientMounted, getServerMounted);
  if (!mounted) return null;
  return children;
}

export function FormSubmitStatus({ doneLine }: { doneLine: string }) {
  const { pending } = useFormStatus();
  const [phase, setPhase] = useState<TaskPhase>("idle");
  const [seenPending, setSeenPending] = useState(false);

  if (pending && phase !== "running") {
    setSeenPending(true);
    setPhase("running");
  } else if (!pending && seenPending && phase !== "done") {
    setSeenPending(false);
    setPhase("done");
  }

  return <TaskRunBanner phase={phase} lines={phase === "done" ? [doneLine] : null} />;
}

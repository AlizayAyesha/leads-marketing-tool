"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { syncCampaignRunAction } from "@/lib/actions/campaigns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

type ActorState = {
  id: string;
  name: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  resultCount: number;
  errorCount: number;
  externalRunId: string | null;
  error: string | null;
};

type MonitorState = {
  status: string;
  leadsCollected: number;
  duplicatesRemoved: number;
  newLeads: number;
  errorCount: number;
  actors: ActorState[];
};

export function CampaignMonitor({
  runId,
  initial,
}: {
  runId: string;
  initial: MonitorState;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (["COMPLETED", "FAILED"].includes(initial.status)) return;
    const timer = setInterval(() => {
      start(async () => {
        await syncCampaignRunAction(runId);
        router.refresh();
        setTick((value) => value + 1);
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [initial.status, runId, router]);

  return (
    <div>
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Metric label="Leads collected" value={initial.leadsCollected} />
        <Metric label="Duplicates removed" value={initial.duplicatesRemoved} />
        <Metric label="New leads" value={initial.newLeads} />
        <Metric label="Errors" value={initial.errorCount} />
      </div>
      <div className="space-y-3">
        {initial.actors.map((actor) => (
          <article key={actor.id} className="glass rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-[family-name:var(--font-syne)]">{actor.name}</h3>
              <Badge tone={actor.status === "RUNNING" ? "WARM" : actor.status === "FAILED" ? "HOT" : "default"}>
                {actor.status}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted">
              {actor.resultCount} results · {actor.errorCount} errors
              {actor.externalRunId ? ` · ${actor.externalRunId}` : ""}
            </p>
            <p className="mt-1 text-xs text-muted">
              start {formatDate(actor.startedAt)} · done {formatDate(actor.completedAt)}
            </p>
            {actor.error ? <p className="mt-2 text-xs text-rose-300">{actor.error}</p> : null}
          </article>
        ))}
      </div>
      <div className="mt-4">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await syncCampaignRunAction(runId);
              router.refresh();
            })
          }
        >
          {pending ? "Syncing…" : "Sync now"}
        </Button>
        {tick > 0 ? <span className="ml-3 text-xs text-muted">auto-sync {tick}</span> : null}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className="mt-2 font-[family-name:var(--font-syne)] text-2xl">{value}</p>
    </div>
  );
}

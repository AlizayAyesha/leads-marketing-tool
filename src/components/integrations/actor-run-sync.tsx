"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { syncActorRunAction } from "@/lib/actions/actors";
import { Button } from "@/components/ui/button";

export function ActorRunSync({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const run = await syncActorRunAction(runId);
            if (!run) {
              setMessage("Run not found");
              return;
            }
            setMessage(
              `${run.status} · ${run.resultCount} results · ${run.ingestedNew} new · ${run.excludedCount} removed`,
            );
            router.refresh();
          })
        }
      >
        {pending ? "Syncing…" : "Sync results"}
      </Button>
      {message ? <span className="text-xs text-emerald-100">{message}</span> : null}
    </div>
  );
}

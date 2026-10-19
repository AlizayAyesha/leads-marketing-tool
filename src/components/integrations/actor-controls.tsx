"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  deleteActor,
  runActorAction,
  setActorActive,
  testActorAction,
} from "@/lib/actions/actors";
import { Button } from "@/components/ui/button";

export function ActorControls({ actorId, active }: { actorId: string; active: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await testActorAction(actorId);
            setMessage(
              [
                `APIFY TEST`,
                `Actor: ${result.actorName}`,
                `Run: ${result.status}`,
                `Items: ${result.items}`,
                `Preview: ${Math.min(5, result.preview.length)} records`,
                `Leads created: ${result.leadsCreated}`,
                `Duplicates: ${result.duplicates}`,
                `Run ID: ${result.runId ?? "n/a"}`,
                `Dataset ID: ${result.datasetId ?? "n/a"}`,
                `External messages sent: ${result.sent}`,
                result.error ? `Error: ${result.error}` : null,
              ]
                .filter(Boolean)
                .join(" · "),
            );
            router.refresh();
          })
        }
      >
        Test Actor
      </Button>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const ok = window.confirm(
              "This Actor may return a large number of records. PostgreSQL stays the source of truth. Continue full RUN?",
            );
            if (!ok) return;
            const result = await runActorAction(actorId);
            setMessage(`Full run queued (${result.taskId}). External messages sent: 0.`);
            router.refresh();
          })
        }
      >
        Run Actor
      </Button>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setActorActive(actorId, !active);
            router.refresh();
          })
        }
      >
        {active ? "Disable" : "Enable"}
      </Button>
      <Button
        variant="danger"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await deleteActor(actorId);
            router.push("/integrations/actors");
          })
        }
      >
        Delete
      </Button>
      {message ? <p className="w-full text-sm text-emerald-100">{message}</p> : null}
    </div>
  );
}

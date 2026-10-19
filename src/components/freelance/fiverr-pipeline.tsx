"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { runFiverrFollowUpAction, runFiverrIntelligenceAction } from "@/lib/actions/freelance";
import { Button } from "@/components/ui/button";

export function FiverrPipelineActions() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="mb-8 glass rounded-2xl p-5">
      <h2 className="mb-2 font-[family-name:var(--font-syne)] text-lg">Fiverr revenue pipeline</h2>
      <p className="mb-4 text-sm text-muted">
        Market intelligence → gig experiment → qualify → draft → follow-up. Nothing is sent without approval.
        Outbound Gmail stays locked at commercial ≥80.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await runFiverrIntelligenceAction();
              setMessage(
                result.ok
                  ? `Market snapshots: ${JSON.stringify((result.output as { opportunities?: unknown[] })?.opportunities?.length ?? 0)} cluster row(s).`
                  : result.error || "Intelligence failed.",
              );
              router.refresh();
            })
          }
        >
          Run market intelligence
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await runFiverrFollowUpAction();
              setMessage(
                result.ok
                  ? `Follow-up drafts: ${(result.output as { drafted?: number })?.drafted ?? 0}`
                  : result.error || "Follow-up failed.",
              );
              router.refresh();
            })
          }
        >
          Prepare follow-ups
        </Button>
      </div>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </div>
  );
}

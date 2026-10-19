"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { optimizeGigAction, startGigExperimentAction } from "@/lib/actions/freelance";
import { Button } from "@/components/ui/button";

export function GigActions({
  gigId,
  analysis,
}: {
  gigId: string;
  analysis: unknown;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const stored =
    analysis && typeof analysis === "object" && !Array.isArray(analysis)
      ? (analysis as {
          recommendations?: Record<string, string[]>;
          experiment?: {
            status?: string;
            currentTitle?: string;
            variantTitle?: string;
            note?: string;
            minDays?: number;
          };
          funnel?: Record<string, number | null>;
        })
      : null;
  const recs = stored?.recommendations ?? (stored && !stored.experiment ? (analysis as Record<string, string[]>) : null);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              await optimizeGigAction(gigId);
              router.refresh();
            })
          }
        >
          Propose experiment
        </Button>
        {stored?.experiment?.variantTitle ? (
          <Button
            variant="outline"
            disabled={pending || stored.experiment.status === "running"}
            onClick={() =>
              start(async () => {
                await startGigExperimentAction(gigId);
                router.refresh();
              })
            }
          >
            Start {stored.experiment.minDays ?? 7}-day title test
          </Button>
        ) : null}
      </div>
      {stored?.experiment?.variantTitle ? (
        <div className="mt-4 text-sm">
          <p className="text-xs uppercase tracking-wider text-muted">Controlled experiment</p>
          <p className="mt-1">Status: {stored.experiment.status}</p>
          <p>Current: {stored.experiment.currentTitle}</p>
          <p>Variant: {stored.experiment.variantTitle}</p>
          {stored.experiment.note ? <p className="mt-2 text-muted">{stored.experiment.note}</p> : null}
        </div>
      ) : null}
      {recs ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm">
          {Object.entries(recs)
            .filter(([, value]) => Array.isArray(value))
            .map(([key, value]) => (
              <div key={key}>
                <p className="text-xs uppercase tracking-wider text-muted">{key.replaceAll("_", " ")}</p>
                <ul className="mt-1 list-disc pl-4">
                  {(value as string[]).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}

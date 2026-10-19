"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { guessMappingFromLastRun, saveActorMapping } from "@/lib/actions/actors";
import { JARVIS_LEAD_FIELDS, type OutputMapping } from "@/lib/actors/mapping";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function ActorMappingForm({
  actorId,
  mapping,
}: {
  actorId: string;
  mapping: OutputMapping;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<OutputMapping>(mapping);
  const [keys, setKeys] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="mb-1 font-[family-name:var(--font-syne)] text-lg">Output mapping</h2>
      <p className="mb-4 text-xs text-muted">
        Map Actor JSON fields onto the standard Jarvis lead. Run a test first to discover keys.
      </p>
      <div className="space-y-2">
        {JARVIS_LEAD_FIELDS.map((field) => (
          <div key={field} className="grid grid-cols-[140px_1fr] items-center gap-2">
            <Label htmlFor={field} className="mb-0">
              {field}
            </Label>
            <Input
              id={field}
              value={draft[field] ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [field]: event.target.value }))
              }
              placeholder="actor field name"
            />
          </div>
        ))}
      </div>
      {keys.length ? (
        <p className="mt-3 text-xs text-muted">Seen keys: {keys.join(", ")}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await guessMappingFromLastRun(actorId);
              if ("error" in result && result.error) {
                setMessage(result.error);
                return;
              }
              if ("mapping" in result && result.mapping) {
                setDraft(result.mapping);
                setKeys(result.keys ?? []);
                setMessage("Guessed mapping from the latest dataset. Review before saving.");
              }
            })
          }
        >
          Guess from last run
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await saveActorMapping(actorId, draft);
              if (result && "error" in result && result.error) {
                setMessage(result.error);
                return;
              }
              setMessage("Mapping saved. Future runs will normalize through this map.");
              router.refresh();
            })
          }
        >
          Save mapping
        </Button>
      </div>
      {message ? <p className="mt-3 text-sm text-emerald-100">{message}</p> : null}
    </section>
  );
}

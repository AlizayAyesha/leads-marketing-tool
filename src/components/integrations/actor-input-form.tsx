"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { refreshActorSchema, saveActorInput, saveManualFields } from "@/lib/actions/actors";
import type { InputFieldDef } from "@/lib/actors/mapping";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";

export function ActorInputForm({
  actorId,
  fields,
  values,
  schemaAvailable,
}: {
  actorId: string;
  fields: InputFieldDef[];
  values: Record<string, unknown>;
  schemaAvailable: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>(stringifyValues(values));
  const [manual, setManual] = useState("searchTerms,location,maxResults");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="mb-1 font-[family-name:var(--font-syne)] text-lg">Input configuration</h2>
      <p className="mb-4 text-xs text-muted">
        {schemaAvailable
          ? "Fields loaded from the Actor input schema."
          : "No live schema. Define fields manually, then save values."}
      </p>
      {fields.length === 0 ? (
        <div className="mb-4 space-y-2">
          <Label htmlFor="manual">Manual field names</Label>
          <Input
            id="manual"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="keyword, country, language, maxResults"
          />
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const defs = manual
                  .split(",")
                  .map((name) => name.trim())
                  .filter(Boolean)
                  .map((name) => ({ name, title: name, type: "string" }));
                await saveManualFields(actorId, defs);
                router.refresh();
              })
            }
          >
            Save field list
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map((field) => (
            <div key={field.name}>
              <Label htmlFor={field.name}>
                {field.title}
                {field.required ? " *" : ""}
              </Label>
              {field.type === "array" || field.type === "object" ? (
                <Textarea
                  id={field.name}
                  value={draft[field.name] ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                  placeholder={field.description}
                />
              ) : (
                <Input
                  id={field.name}
                  type={field.type === "number" ? "number" : field.type === "boolean" ? "text" : "text"}
                  value={draft[field.name] ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                  placeholder={field.description}
                />
              )}
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={pending || fields.length === 0}
          onClick={() =>
            start(async () => {
              await saveActorInput(actorId, parseValues(draft, fields));
              setMessage("Input saved. Test runs force a maximum of 5 results.");
              router.refresh();
            })
          }
        >
          Save input
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await refreshActorSchema(actorId);
              setMessage(result.error || "Schema refreshed from Apify.");
              router.refresh();
            })
          }
        >
          Refresh schema
        </Button>
      </div>
      {message ? <p className="mt-3 text-sm text-emerald-100">{message}</p> : null}
    </section>
  );
}

function stringifyValues(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  );
}

function parseValues(draft: Record<string, string>, fields: InputFieldDef[]) {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = draft[field.name];
    if (raw == null || raw === "") continue;
    if (field.type === "number") result[field.name] = Number(raw);
    else if (field.type === "boolean") result[field.name] = raw === "true" || raw === "1";
    else if (field.type === "array") {
      try {
        result[field.name] = JSON.parse(raw);
      } catch {
        result[field.name] = raw.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
      }
    } else if (field.type === "object") {
      try {
        result[field.name] = JSON.parse(raw);
      } catch {
        result[field.name] = raw;
      }
    } else {
      result[field.name] = raw;
    }
  }
  return result;
}

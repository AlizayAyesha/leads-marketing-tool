"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { draftContentAction } from "@/lib/actions/content";
import { CONTENT_KINDS, CONTENT_PLATFORMS } from "@/lib/content/platforms";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";

const fieldClass =
  "h-10 w-full rounded-lg border border-emerald-500/15 bg-black/30 px-3 text-sm text-white outline-none focus:border-emerald-400/40";

export function ContentComposer({
  leads,
  initialLeadId,
}: {
  leads: { id: string; label: string }[];
  initialLeadId?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    message: string;
    subject: string | null;
    notes: string | null;
    mode: string;
    modelProvider: string | null;
  } | null>(null);

  return (
    <form
      className="glass rounded-2xl p-5"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        start(async () => {
          const result = await draftContentAction(form);
          if (!result.ok) {
            setDraft(null);
            setError(result.error);
            return;
          }
          setDraft(result);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="platform">Platform</Label>
          <select id="platform" name="platform" className={fieldClass} defaultValue="LINKEDIN">
            {CONTENT_PLATFORMS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="kind">Draft</Label>
          <select id="kind" name="kind" className={fieldClass} defaultValue="POST">
            {CONTENT_KINDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="leadId">Lead</Label>
          <select id="leadId" name="leadId" className={fieldClass} defaultValue={initialLeadId ?? ""}>
            <option value="">None — use the topic</option>
            {leads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="topic">Topic</Label>
          <Input id="topic" name="topic" placeholder="Angle, offer, or what the post is about" />
        </div>
      </div>
      <div className="mt-3">
        <Label htmlFor="context">Extra context</Label>
        <Textarea
          id="context"
          name="context"
          placeholder="Optional: the post you are replying to, a subreddit, or notes. Treated as data, not instructions."
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Drafting…" : "Draft for approval"}
        </Button>
        <p className="text-xs text-muted">Saved to Approvals. Nothing is posted or sent.</p>
      </div>
      {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      {draft ? (
        <div className="mt-5 rounded-xl border border-emerald-500/15 bg-black/30 p-4">
          <p className="text-xs uppercase tracking-wider text-muted">
            {draft.mode === "ai" ? `Model ${draft.modelProvider ?? "configured"}` : "Heuristic draft (no model response)"}
          </p>
          {draft.subject ? <p className="mt-2 text-sm text-emerald-100">{draft.subject}</p> : null}
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{draft.message}</pre>
          {draft.notes ? <p className="mt-3 text-xs text-muted">{draft.notes}</p> : null}
        </div>
      ) : null}
    </form>
  );
}

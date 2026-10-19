"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { savePrompt } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

export function PromptEditor({
  agentSlug,
  name,
  content,
}: {
  agentSlug: string;
  name: string;
  content: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(content);
  const [pending, start] = useTransition();

  return (
    <article className="glass rounded-2xl p-5">
      <h3 className="mb-3 font-[family-name:var(--font-syne)]">{name}</h3>
      <Textarea className="min-h-40 font-mono text-xs" value={value} onChange={(event) => setValue(event.target.value)} />
      <Button
        className="mt-3"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await savePrompt(agentSlug, value);
            router.refresh();
          })
        }
      >
        Save prompt
      </Button>
    </article>
  );
}

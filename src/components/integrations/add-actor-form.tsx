"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createActor } from "@/lib/actions/actors";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";

export function AddActorForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="glass max-w-2xl space-y-4 rounded-2xl p-6"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        start(async () => {
          const result = await createActor(form);
          if ("error" in result && result.error) {
            setError(result.error);
            return;
          }
          if ("id" in result && result.id) router.push(`/integrations/actors/${result.id}`);
        });
      }}
    >
      <div>
        <Label htmlFor="actorId">Actor ID</Label>
        <Input id="actorId" name="actorId" required placeholder="apify/google-maps-scraper" />
      </div>
      <div>
        <Label htmlFor="displayName">Display name</Label>
        <Input id="displayName" name="displayName" required placeholder="Google Maps Lead Scraper" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="platform">Platform</Label>
          <Input id="platform" name="platform" placeholder="Google Maps" />
        </div>
        <div>
          <Label htmlFor="category">Category</Label>
          <Input id="category" name="category" placeholder="Lead Generation" />
        </div>
      </div>
      <div>
        <Label htmlFor="sourceType">Source type</Label>
        <Input id="sourceType" name="sourceType" placeholder="google_maps / website / directory" />
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" />
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" name="allowWithoutMeta" value="1" className="accent-emerald-400" />
        Save even if Apify metadata cannot be loaded
      </label>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Registering…" : "Add Actor"}
      </Button>
    </form>
  );
}

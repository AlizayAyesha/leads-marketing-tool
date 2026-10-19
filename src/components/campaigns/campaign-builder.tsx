"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveCampaign } from "@/lib/actions/campaigns";
import {
  DEFAULT_CAMPAIGN_CITIES,
  DEFAULT_CAMPAIGN_REGIONS,
  DEFAULT_NEED_CRITERIA,
  type CompanySize,
} from "@/lib/campaigns/intent";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";

type ActorOption = {
  id: string;
  label: string;
  actorId: string;
  platform: string | null;
};

const SIZE_OPTIONS: CompanySize[] = ["SMB", "LARGE"];

export function CampaignBuilder({
  campaignId,
  actors,
  initial,
}: {
  campaignId?: string;
  actors: ActorOption[];
  initial?: {
    name: string;
    description: string;
    actorIds: string[];
    runAiAfterScrape: boolean;
    sheetSpreadsheetId: string;
    sheetWorksheet: string;
    targetCount: number;
    cities: string;
    regions: string;
    companySizes: CompanySize[];
    needCriteria: string;
  };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [actorIds, setActorIds] = useState<string[]>(initial?.actorIds ?? []);
  const [runAi, setRunAi] = useState(initial?.runAiAfterScrape ?? false);
  const [sheetId, setSheetId] = useState(initial?.sheetSpreadsheetId ?? "");
  const [sheetName, setSheetName] = useState(initial?.sheetWorksheet ?? "");
  const [targetCount, setTargetCount] = useState(String(initial?.targetCount ?? 10));
  const [cities, setCities] = useState(initial?.cities ?? DEFAULT_CAMPAIGN_CITIES.join(", "));
  const [regions, setRegions] = useState(initial?.regions ?? DEFAULT_CAMPAIGN_REGIONS.join(", "));
  const [companySizes, setCompanySizes] = useState<CompanySize[]>(
    initial?.companySizes?.length ? initial.companySizes : ["SMB", "LARGE"],
  );
  const [needCriteria, setNeedCriteria] = useState(initial?.needCriteria ?? DEFAULT_NEED_CRITERIA);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="glass space-y-5 rounded-2xl p-6"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await saveCampaign({
            id: campaignId,
            name,
            description,
            actorIds,
            runAiAfterScrape: runAi,
            sheetSpreadsheetId: sheetId,
            sheetWorksheet: sheetName,
            targetCount: Number(targetCount) || 10,
            cities,
            regions,
            companySizes,
            needCriteria,
          });
          if (result.error) {
            setError(result.error);
            return;
          }
          router.push(`/campaigns/${result.id}`);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="name">Campaign name</Label>
          <Input
            id="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            placeholder="Karachi + Brazil tech need"
          />
        </div>
        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            className="min-h-10"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <p className="mb-3 text-xs uppercase tracking-wider text-muted">Campaign brief</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="targetCount">Target leads (N)</Label>
            <Input
              id="targetCount"
              type="number"
              min={1}
              max={500}
              value={targetCount}
              onChange={(event) => setTargetCount(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="needCriteria">Need criteria</Label>
            <Input
              id="needCriteria"
              value={needCriteria}
              onChange={(event) => setNeedCriteria(event.target.value)}
              placeholder="modern website, AI automation"
            />
          </div>
          <div>
            <Label htmlFor="cities">Cities</Label>
            <Input
              id="cities"
              value={cities}
              onChange={(event) => setCities(event.target.value)}
              placeholder="Karachi, Ibiza, Mykonos, Dubai…"
            />
          </div>
          <div>
            <Label htmlFor="regions">Regions</Label>
            <Input
              id="regions"
              value={regions}
              onChange={(event) => setRegions(event.target.value)}
              placeholder="Pakistan, Brazil"
            />
          </div>
        </div>
        <div className="mt-3">
          <p className="mb-2 text-xs text-muted">Company size</p>
          <div className="flex flex-wrap gap-3">
            {SIZE_OPTIONS.map((size) => {
              const checked = companySizes.includes(size);
              return (
                <label key={size} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-emerald-400"
                    checked={checked}
                    onChange={() =>
                      setCompanySizes((current) =>
                        checked ? current.filter((item) => item !== size) : [...current, size],
                      )
                    }
                  />
                  {size === "SMB" ? "SMB / mini" : "Large / enterprise"}
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wider text-muted">Actors</p>
        {actors.length === 0 ? (
          <p className="text-sm text-muted">Register an actor in Integrations first.</p>
        ) : (
          <div className="space-y-2">
            {actors.map((actor) => {
              const checked = actorIds.includes(actor.id);
              return (
                <label key={actor.id} className="flex items-center gap-3 rounded-xl border border-white/5 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-emerald-400"
                    checked={checked}
                    onChange={() =>
                      setActorIds((current) =>
                        checked ? current.filter((id) => id !== actor.id) : [...current, actor.id],
                      )
                    }
                  />
                  <span>
                    {actor.label}
                    <span className="ml-2 text-xs text-muted">
                      {actor.actorId}
                      {actor.platform ? ` · ${actor.platform}` : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="accent-emerald-400"
          checked={runAi}
          onChange={(event) => setRunAi(event.target.checked)}
        />
        Run AI analysis after scraping
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="sheetId">Google spreadsheet ID (optional export)</Label>
          <Input id="sheetId" value={sheetId} onChange={(event) => setSheetId(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="sheetName">Worksheet name</Label>
          <Input
            id="sheetName"
            value={sheetName}
            onChange={(event) => setSheetName(event.target.value)}
            placeholder="Karachi Brazil Leads"
          />
        </div>
      </div>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save campaign"}
      </Button>
    </form>
  );
}

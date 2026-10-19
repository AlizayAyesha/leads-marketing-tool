"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { exportCampaignSheetAction, runCampaignAction } from "@/lib/actions/campaigns";
import { Button } from "@/components/ui/button";

export function CampaignRunControls({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await runCampaignAction(campaignId, true);
            router.push(`/campaigns/${campaignId}/runs/${result.runId}`);
          })
        }
      >
        Test campaign (max 5)
      </Button>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await runCampaignAction(campaignId, false);
            router.push(`/campaigns/${campaignId}/runs/${result.runId}`);
          })
        }
      >
        Run campaign
      </Button>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await exportCampaignSheetAction(campaignId);
            setMessage(
              result && "error" in result && result.error
                ? result.error
                : `Exported ${"exported" in result ? result.exported : 0} leads to Sheets.`,
            );
          })
        }
      >
        Export to Sheets
      </Button>
      {message ? <p className="w-full text-sm text-emerald-100">{message}</p> : null}
    </div>
  );
}

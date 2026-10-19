"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { prepareProposalAction, qualifyOpportunityAction } from "@/lib/actions/freelance";
import { Button } from "@/components/ui/button";

export function OpportunityActions({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await qualifyOpportunityAction(opportunityId);
            router.refresh();
          })
        }
      >
        Re-score
      </Button>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            await prepareProposalAction(opportunityId);
            router.refresh();
          })
        }
      >
        Prepare proposal
      </Button>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  approveProposal,
  editProposal,
  recordManualSubmit,
  rejectProposal,
} from "@/lib/actions/freelance";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

export function ProposalActions({
  proposalId,
  body,
  status,
}: {
  proposalId: string;
  body: string;
  status: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      {editing ? (
        <Textarea className="min-h-40" value={draft} onChange={(event) => setDraft(event.target.value)} />
      ) : (
        <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200">{body}</pre>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {status === "AWAITING_APPROVAL" || status === "DRAFT" ? (
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await approveProposal(proposalId);
                setNotice(result.message);
                router.refresh();
              })
            }
          >
            Approve
          </Button>
        ) : null}
        <Button variant="outline" disabled={pending} onClick={() => setEditing((value) => !value)}>
          Edit
        </Button>
        {editing ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await editProposal(proposalId, draft);
                setEditing(false);
                router.refresh();
              })
            }
          >
            Save edit
          </Button>
        ) : null}
        <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reject reason" />
        <Button
          variant="danger"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await rejectProposal(proposalId, reason);
              router.refresh();
            })
          }
        >
          Reject
        </Button>
        {status === "APPROVED" ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await recordManualSubmit(proposalId);
                setNotice("Recorded as submitted by the operator. Jarvis did not call Upwork or Fiverr.");
                router.refresh();
              })
            }
          >
            Record manual submit
          </Button>
        ) : null}
      </div>
      {notice ? <p className="mt-3 text-xs text-emerald-200">{notice}</p> : null}
    </div>
  );
}

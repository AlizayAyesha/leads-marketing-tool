"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { approveAllPendingDrafts, approveDraft, editDraft, regenerateDraft, rejectDraft } from "@/lib/actions/outreach";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

export function ApproveAllBar({
  eligibleCount,
  pendingCount = eligibleCount,
}: {
  eligibleCount: number;
  pendingCount?: number;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canApprove = eligibleCount >= 1;

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3">
      <p className="text-sm text-muted">
        Approve all: {eligibleCount} eligible of {pendingCount} pending
        {canApprove
          ? " (Decision Maker PASS or reply). Same rules as Approve — X/LinkedIn stay queued until Daily Outreach; Gmail still gated."
          : pendingCount > 0
            ? ". None have Decision Maker PASS yet, so bulk approve stays off."
            : ". Run Today's Outreach to generate drafts, then they show up here."}
      </p>
      <Button
        disabled={pending || !canApprove}
        onClick={() => {
          if (!window.confirm(`Approve all ${eligibleCount} eligible drafts?`)) return;
          start(async () => {
            const result = await approveAllPendingDrafts();
            setNotice(result.message);
            router.refresh();
          });
        }}
      >
        {pending ? "Approving…" : `Approve all (${eligibleCount})`}
      </Button>
      {notice ? <p className="w-full text-xs text-emerald-200">{notice}</p> : null}
    </div>
  );
}

export function ApprovalActions({
  draftId,
  message,
  subject,
  eligible,
  ineligibleReason,
}: {
  draftId: string;
  message: string;
  subject?: string | null;
  eligible?: boolean;
  ineligibleReason?: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message);
  const [title, setTitle] = useState(subject ?? "");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const canApprove = eligible !== false;

  return (
    <div className="mt-4 space-y-3">
      {!canApprove ? (
        <p className="text-sm text-amber-200">
          {ineligibleReason || "Decision Maker did not PASS. This draft cannot be approved or sent."}
        </p>
      ) : null}
      {editing ? (
        <div className="space-y-2">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Subject" />
          <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-40" />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending || !canApprove}
          onClick={() =>
            start(async () => {
              const result = await approveDraft(draftId);
              setNotice(result.message);
              router.refresh();
            })
          }
        >
          Approve
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => setEditing((value) => !value)}>
          Edit
        </Button>
        <Button
          variant="outline"
          disabled={pending || !canApprove}
          onClick={() =>
            start(async () => {
              const result = await regenerateDraft(draftId);
              setNotice(result.message);
              router.refresh();
            })
          }
        >
          Regenerate
        </Button>
        {editing ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await editDraft(draftId, draft, title);
                setEditing(false);
                router.refresh();
              })
            }
          >
            Save edit
          </Button>
        ) : null}
        <div className="flex flex-1 gap-2">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reject reason"
          />
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await rejectDraft(draftId, reason);
                router.refresh();
              })
            }
          >
            Reject
          </Button>
        </div>
      </div>
      {notice ? <p className="text-xs text-emerald-200">{notice}</p> : null}
    </div>
  );
}

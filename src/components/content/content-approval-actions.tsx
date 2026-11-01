"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { approveContentDraft, editContentDraft, rejectContentDraft } from "@/lib/actions/content";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

export function ContentApprovalActions({
  draftId,
  message,
  subject,
}: {
  draftId: string;
  message: string;
  subject?: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message);
  const [title, setTitle] = useState(subject ?? "");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-muted">Approval only saves your decision. Copy the text and post it yourself.</p>
      {editing ? (
        <div className="space-y-2">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title (optional)" />
          <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-40" />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await approveContentDraft(draftId);
              setNotice(result.message);
              router.refresh();
            })
          }
        >
          Approve
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            void navigator.clipboard?.writeText(editing ? draft : message);
            setNotice("Copied. Paste it on the platform yourself.");
          }}
        >
          Copy
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => setEditing((value) => !value)}>
          Edit
        </Button>
        {editing ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await editContentDraft(draftId, draft, title);
                setEditing(false);
                setNotice(result.message);
                router.refresh();
              })
            }
          >
            Save edit
          </Button>
        ) : null}
        <div className="flex flex-1 gap-2">
          <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reject reason" />
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await rejectContentDraft(draftId, reason);
                setNotice(result.message);
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

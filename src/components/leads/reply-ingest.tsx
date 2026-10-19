import { ingestReplyFormAction } from "@/lib/actions/outreach";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

export function ReplyIngestForm({
  leadId,
  defaultChannel = "EMAIL",
}: {
  leadId: string;
  defaultChannel?: "EMAIL" | "LINKEDIN";
}) {
  return (
    <form action={ingestReplyFormAction} className="mt-4 space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <label className="block text-xs text-muted">
        Channel
        <select
          name="channel"
          defaultValue={defaultChannel}
          className="mt-1 block w-full rounded-lg border border-emerald-500/20 bg-black/30 px-3 py-2 text-sm text-white"
        >
          <option value="EMAIL">Email</option>
          <option value="LINKEDIN">LinkedIn</option>
        </select>
      </label>
      <Textarea name="text" placeholder="Paste their reply. Jarvis drafts a response. You approve. Jarvis does not send." />
      <Button type="submit" variant="outline">
        Record reply
      </Button>
    </form>
  );
}

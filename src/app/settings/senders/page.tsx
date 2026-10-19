import { removeSenderAction, updateSenderAction } from "@/lib/actions/senders";
import { listSenderAccounts } from "@/lib/outreach/sender-accounts";
import { maxSenderDailyLimit } from "@/lib/outreach/sender-pool";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";

export const dynamic = "force-dynamic";

export default async function SenderInboxesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const accounts = await listSenderAccounts().catch(() => []);
  const max = maxSenderDailyLimit();
  const error = typeof params.error === "string" ? params.error : null;
  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Sender inboxes"
        description="Connect your team or business Gmail inboxes. Approved drafts are assigned round-robin across enabled inboxes, each with its own daily limit. The kill switch, global daily limit, suppression list and unsubscribe footer still apply to every send."
      />
      {error ? <p className="mb-4 text-sm text-red-400">Could not connect: {error}</p> : null}
      <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
        <p className="font-semibold">Warm-up and Google sender guidelines</p>
        <ul className="mt-2 list-disc pl-5">
          <li>New inboxes start at 1 email/day. Raise limits slowly (for example +1–2/day per week) as replies come in.</li>
          <li>Only connect inboxes you own or are authorized to send from. Use real people/roles, not throwaway accounts.</li>
          <li>Using many accounts to get around Gmail sending limits violates Google&apos;s policies and can get every account suspended.</li>
          <li>Keep the unsubscribe footer and your postal address (OUTREACH_SENDER_ADDRESS) on, and honour opt-outs.</li>
        </ul>
      </div>
      <a href="/api/google/oauth?sender=1" className="mb-6 inline-block">
        <Button type="button">+ Connect a Gmail inbox</Button>
      </a>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted">No sender inboxes yet. Without any, sends use the single Google connection from Settings.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="py-2">Inbox</th>
              <th>Sent today</th>
              <th>Daily limit (max {max})</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-t border-white/5">
                <td className="py-3">
                  {a.email}
                  {!a.canSend ? <span className="ml-2 text-xs text-red-400">missing gmail.send — reconnect</span> : null}
                </td>
                <td>
                  {a.sentToday} / {a.dailySendLimit}
                </td>
                <td>
                  <form action={updateSenderAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={a.id} />
                    <Input name="dailySendLimit" type="number" min={0} max={max} defaultValue={a.dailySendLimit} className="w-20" />
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" name="enabled" defaultChecked={a.enabled} /> enabled
                    </label>
                    <Button type="submit">Save</Button>
                  </form>
                </td>
                <td>
                  <form action={removeSenderAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <Button type="submit">Remove</Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

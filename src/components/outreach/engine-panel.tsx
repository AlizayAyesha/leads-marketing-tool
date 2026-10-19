import { saveOutreachEngineAction } from "@/lib/actions/outreach";
import { OutreachEngineRunButtons } from "@/components/outreach/run-task-buttons";
import { EngineSaveControls } from "@/components/outreach/engine-save-controls";
import { Input, Label } from "@/components/ui/input";
import type { OutreachEnginePolicy } from "@/lib/outreach/policy";

export function OutreachEnginePanel({
  policy,
  sentToday,
  gmailSendReady,
  googleEmail,
  socialAutomation = false,
}: {
  policy: OutreachEnginePolicy;
  sentToday: number;
  gmailSendReady: boolean;
  googleEmail?: string | null;
  socialAutomation?: boolean;
}) {
  return (
    <section className="mb-8 glass rounded-2xl p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-syne)] text-lg">Outreach engine</h2>
          <p className="mt-1 text-sm text-muted">
            Discover → Enrich → Research → Qualify → Rank → Connection → Connected → Conversation → Meeting.
            Discovery data is not eligibility. HOLD/REJECT, juniors, and profiles without a mapped your business
            opportunity never get a connection recommendation. Daily caps are ceilings, not quotas.
            Sent today {sentToday}/{policy.dailySendLimit}. Kill switch is{" "}
            {policy.sendsPaused ? "on" : "off"}.
          </p>
        </div>
        <OutreachEngineRunButtons socialAutomation={socialAutomation} />
      </div>
      <p className="mb-4 text-xs text-muted">
        {socialAutomation
          ? "Click run and Jarvis owns it: kill switch off, LinkedIn Daily on, X Daily on, auto-send for PASS email that clears commercial gates, Approve-all for eligible drafts, follow-ups queued. You do not toggle these by hand."
          : "Click run and Jarvis owns it: kill switch off, auto-send for PASS email that clears commercial gates, Approve-all for eligible drafts, follow-ups queued. You do not toggle these by hand."}
      </p>

      <details className="mb-4 rounded-xl border border-white/10 p-3">
        <summary className="cursor-pointer text-sm text-emerald-200">Advanced limits (optional)</summary>
        <form action={saveOutreachEngineAction} className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={policy.enabled} />
          Engine on
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="sendsPaused" defaultChecked={policy.sendsPaused} />
          Kill switch (pause all sends)
        </label>
        <div>
          <Label htmlFor="sendMode">Send mode</Label>
          <select
            id="sendMode"
            name="sendMode"
            defaultValue={policy.sendMode}
            className="h-10 w-full rounded-lg border border-emerald-500/15 bg-black/30 px-3 text-sm text-white"
          >
            <option value="draft_only">Draft only — never send</option>
            <option value="send_on_approve">Send email when I approve</option>
            <option value="auto">Auto-send PASS email (still limited)</option>
          </select>
        </div>
        <div>
          <Label htmlFor="dailySendLimit">Daily send limit</Label>
          <Input id="dailySendLimit" name="dailySendLimit" type="number" min={0} defaultValue={policy.dailySendLimit} />
        </div>
        <div>
          <Label htmlFor="maxActiveSequences">Max active sequences</Label>
          <Input
            id="maxActiveSequences"
            name="maxActiveSequences"
            type="number"
            min={1}
            defaultValue={policy.maxActiveSequences}
          />
        </div>
        <div>
          <Label htmlFor="bookingUrl">Meeting booking URL</Label>
          <Input id="bookingUrl" name="bookingUrl" defaultValue={policy.bookingUrl} placeholder="https://…" />
          <p className="mt-1 text-xs text-muted">
            {socialAutomation
              ? "Email fallback and LinkedIn hop destination if LINKEDIN_SCHEDULER_URL is unset. LinkedIn DMs still send /go/linkedin?source=linkedin&lead=… — never on a problem. The hop 302s to Calendly with attribution."
              : "Meeting link used in email."}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="emailEnabled" defaultChecked={policy.emailEnabled} />
          Email sequences
        </label>
        {socialAutomation ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="linkedinDrafts" defaultChecked={policy.linkedinDrafts} />
            LinkedIn drafts
          </label>
        ) : policy.linkedinDrafts ? (
          <input type="hidden" name="linkedinDrafts" value="on" />
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="instagramDrafts" defaultChecked={policy.instagramDrafts} />
          Instagram drafts
        </label>
        {socialAutomation ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="twitterDrafts" defaultChecked={policy.twitterDrafts} />
            X / Twitter drafts
          </label>
        ) : policy.twitterDrafts ? (
          <input type="hidden" name="twitterDrafts" value="on" />
        ) : null}
        {socialAutomation ? (
          <>
        <div>
          <Label htmlFor="twitterDmDailyCap">X DM sends / day</Label>
          <Input
            id="twitterDmDailyCap"
            name="twitterDmDailyCap"
            type="number"
            min={0}
            max={100}
            defaultValue={policy.twitterDmDailyCap}
          />
        </div>
        <div>
          <Label htmlFor="linkedinConnectionDailyCap">LinkedIn connection recs / day</Label>
          <Input
            id="linkedinConnectionDailyCap"
            name="linkedinConnectionDailyCap"
            type="number"
            min={0}
            max={100}
            defaultValue={policy.linkedinConnectionDailyCap}
          />
        </div>
        <div>
          <Label htmlFor="linkedinMessageDailyCap">LinkedIn message recs / day</Label>
          <Input
            id="linkedinMessageDailyCap"
            name="linkedinMessageDailyCap"
            type="number"
            min={0}
            max={100}
            defaultValue={policy.linkedinMessageDailyCap}
          />
        </div>
          </>
        ) : null}
        <div className="md:col-span-2">
          <EngineSaveControls />
          {gmailSendReady ? (
            <p className="mt-2 text-xs text-emerald-200">Gmail send connected{googleEmail ? ` as ${googleEmail}` : ""}.</p>
          ) : (
            <a href="/api/google/oauth?gmail=1" className="mt-2 inline-block text-sm text-emerald-300 underline">
              Reconnect Google with Gmail send
            </a>
          )}
        </div>
      </form>
      </details>
      <p className="mt-4 text-xs text-muted">
        {socialAutomation ? "LinkedIn and X use Jarvis Chrome. " : ""}
        Instagram stays draft-only. Replies stop a sequence. Daily caps are Jarvis ceilings. Keep /api/queue/process on
        a schedule so follow-ups keep moving.
      </p>
    </section>
  );
}

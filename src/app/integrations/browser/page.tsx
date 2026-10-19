import { BrowserConnect } from "@/components/integrations/browser-connect";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page";
import { getChromeSession, listBrowserTraces } from "@/lib/tools/chrome";

export const dynamic = "force-dynamic";

export default function BrowserAgentPage() {
  const session = getChromeSession();
  const traces = listBrowserTraces().slice(-8).reverse();
  const connected = session.status === "CONNECTED";

  return (
    <div>
      <PageHeader
        eyebrow="Devices"
        title="Jarvis Chrome"
        description="Connect opens a Jarvis Chrome window and LinkedIn. Sign in there once. Everyday Chrome is not used."
      />
      <article className="glass max-w-2xl rounded-2xl p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-syne)] text-xl">Chrome</h2>
          <Badge tone={connected ? "HOT" : "muted"}>{session.status}</Badge>
        </div>
        <p className="text-sm text-muted">Active profile: {connected ? session.profile : "Jarvis Chrome"}</p>
        {session.lastUrl ? <p className="mt-1 text-sm text-muted">Last page: {session.lastUrl}</p> : null}
        {session.lastError ? <p className="mt-2 text-sm text-amber-200">{session.lastError}</p> : null}
        <ul className="mt-4 space-y-1 text-sm text-emerald-100/90">
          <li>✓ Navigation</li>
          <li>✓ Research / page read</li>
          <li>✓ Sheets (workspace, not the database)</li>
          <li>✓ File operations</li>
          <li>✓ LinkedIn account actions (connect / status / message) when Daily or isolated test is authorized</li>
          <li>✓ Form preparation</li>
        </ul>
        <p className="mt-3 text-xs uppercase tracking-wider text-muted">External actions: approval required</p>
        <div className="mt-4">
          <BrowserConnect connected={connected} />
        </div>
      </article>

      <section className="mt-6 max-w-2xl glass rounded-2xl p-5">
        <h2 className="mb-3 font-[family-name:var(--font-syne)] text-lg">Recent traces</h2>
        {traces.length === 0 ? <p className="text-sm text-muted">No browser tasks yet.</p> : null}
        <div className="space-y-2 text-sm">
          {traces.map((trace) => (
            <div key={`${trace.timestamp}-${trace.action}`} className="flex justify-between gap-3 border-b border-white/5 pb-2">
              <span>
                {trace.action} · {trace.domain || trace.url || "n/a"} · {trace.result}
              </span>
              <span className="text-muted">{trace.duration_ms}ms</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

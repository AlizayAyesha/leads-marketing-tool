import type { LinkedInLeadBlocker } from "@/lib/linkedin/connection/blockers";

export function LinkedInBlockersPanel({ rows }: { rows: LinkedInLeadBlocker[] }) {
  const sendable = rows.filter((row) => row.sendable);
  const blocked = rows.filter((row) => !row.sendable);

  return (
    <section className="mb-8 glass rounded-2xl p-5">
      <p className="text-[11px] uppercase tracking-[0.22em] text-amber-300/90">Why LinkedIn is not sending</p>
      <h2 className="mt-1 font-[family-name:var(--font-syne)] text-lg">Sheet / scraped LinkedIn leads</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Opening LinkedIn is not enough. Jarvis only sends connections to PASS buyers with verified research and a
        commercial opportunity. {sendable.length} ready · {blocked.length} blocked.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No production leads with a LinkedIn URL yet. Import the sheet first.</p>
      ) : (
        <ul className="mt-4 space-y-2 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-white/5 pb-2">
              <span className={row.sendable ? "text-emerald-100" : "text-amber-100"}>
                {row.name || row.company || row.leadId}
              </span>
              <span className="text-muted">
                {" "}
                · {row.audit}/{row.research} · {row.connectionStatus} · {row.code}
              </span>
              <p className="text-xs text-muted">{row.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

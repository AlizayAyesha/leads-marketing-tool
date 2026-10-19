import Link from "next/link";
import { notFound } from "next/navigation";

import { type EvidenceChain } from "@/lib/analytics/evidence";
import { getSalesEvidenceBoard, salesKindTitle, type SalesKind } from "@/lib/analytics/sales";
import { formatDate } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/ui/page";

export const dynamic = "force-dynamic";

const KINDS: SalesKind[] = ["replies", "opportunities", "meetings", "clients"];

function isSalesKind(value: string): value is SalesKind {
  return KINDS.includes(value as SalesKind);
}

function EvidenceMarks({ marks }: { marks: readonly string[] }) {
  return (
    <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-emerald-300/80">
      {marks.map((mark) => `✓ ${mark}`).join("  ")}
    </p>
  );
}

function ChainStep({
  label,
  value,
  href,
}: {
  label: string;
  value?: string | null;
  href?: string | null;
}) {
  return (
    <div className="border-t border-white/5 py-2 first:border-t-0 first:pt-0">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</p>
      {href && value ? (
        <a className="mt-1 block break-all text-sm text-emerald-300 underline" href={href}>
          {value}
        </a>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-sm">{value || "No evidence yet"}</p>
      )}
    </div>
  );
}

function EvidenceChainView({ chain }: { chain?: EvidenceChain }) {
  if (!chain) return null;
  const prospect = [chain.prospect, chain.company].filter(Boolean).join(" · ") || chain.leadId;
  return (
    <div className="mt-4 rounded-xl bg-black/30 p-4">
      <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-emerald-300/80">
        Prospect → LinkedIn → conversation → their message → need → Jarvis → CTA → booking
      </p>
      <ChainStep label="Prospect" value={`${prospect} · ${chain.leadId}`} />
      <ChainStep label="LinkedIn profile" value={chain.profileUrl} href={chain.profileUrl} />
      <ChainStep label="Conversation" value="Open lead conversation" href={chain.conversationHref} />
      <ChainStep label="Their exact message" value={chain.inboundMessage} />
      <ChainStep label="Evidence of need" value={chain.need} />
      <ChainStep label="Jarvis response" value={chain.jarvisResponse} />
      <ChainStep label="CTA" value={chain.ctaUrl} href={chain.ctaUrl} />
      <ChainStep label="Booking" value={chain.bookedAt ? formatDate(chain.bookedAt) : null} />
      <p className="mt-2 text-xs text-muted">
        {[chain.connectionStatus, chain.provider, chain.externalId].filter(Boolean).join(" · ") || "No provider trace yet"}
      </p>
    </div>
  );
}

export default async function SalesEvidencePage({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind } = await params;
  if (!isSalesKind(kind)) notFound();
  const board = await getSalesEvidenceBoard();
  const rows = board.rows[kind];

  return (
    <div>
      <PageHeader
        eyebrow="Evidence"
        title={salesKindTitle(kind)}
        description="If Jarvis cannot open the underlying production record, it cannot count the event."
        actions={
          <Link href="/" className="text-sm text-emerald-300">
            Back to dashboard
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title={`No ${salesKindTitle(kind).toLowerCase()} yet`}
          description="Test harnesses and research placeholders are hidden. This stays at zero until a real prospect produces evidence."
        />
      ) : kind === "replies" ? (
        <div className="space-y-4">
          {board.rows.replies.map((row) => (
            <article key={row.id} className="glass rounded-2xl p-5">
              <h2 className="font-[family-name:var(--font-syne)] text-lg">{row.company || row.name || row.leadId}</h2>
              <p className="text-sm text-muted">
                {row.name} · {row.channel} · {formatDate(row.repliedAt)} · {row.stage}
              </p>
              <p className="mt-3 text-sm">Their reply: {row.reply}</p>
              <p className="mt-2 text-sm text-muted">Jarvis draft: {row.draftedResponse || "—"}</p>
              <EvidenceChainView chain={row.chain} />
              <EvidenceMarks marks={row.evidence} />
              <Link href={row.conversationHref} className="mt-3 inline-block text-sm text-emerald-300">
                View conversation →
              </Link>
            </article>
          ))}
        </div>
      ) : kind === "opportunities" ? (
        <div className="space-y-4">
          {board.rows.opportunities.map((row) => (
            <article key={row.id} className="glass rounded-2xl p-5">
              <h2 className="font-[family-name:var(--font-syne)] text-lg">Opportunity — {row.company || row.name || row.leadId}</h2>
              <p className="mt-2 text-sm">Evidence: “{row.evidence}”</p>
              <p className="mt-1 text-sm text-muted">Source: {row.source}</p>
              <EvidenceChainView chain={row.chain} />
              <EvidenceMarks marks={row.marks} />
              <div className="mt-3 flex gap-4 text-sm text-emerald-300">
                <Link href={row.conversationHref}>View conversation →</Link>
                <Link href={row.conversationHref}>View evidence →</Link>
              </div>
            </article>
          ))}
        </div>
      ) : kind === "meetings" ? (
        <div className="space-y-4">
          {board.rows.meetings.map((row) => (
            <article key={row.id} className="glass rounded-2xl p-5">
              <h2 className="font-[family-name:var(--font-syne)] text-lg">{row.company || row.name || row.leadId}</h2>
              <p className="text-sm text-muted">
                {row.name} · booked {formatDate(row.bookedAt)} · source={row.source} · {row.status}
              </p>
              <p className="mt-2 text-sm">Attribution ID: {row.attributionId}</p>
              {row.calendlyUrl ? (
                <p className="mt-1 text-sm">
                  Calendly:{" "}
                  <a className="underline" href={row.calendlyUrl}>
                    {row.calendlyUrl}
                  </a>
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">Calendly URL was not stored on this booking.</p>
              )}
              <EvidenceChainView chain={row.chain} />
              <EvidenceMarks marks={row.marks} />
              <Link href={row.conversationHref} className="mt-3 inline-block text-sm text-emerald-300">
                View conversation that led to the booking →
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {board.rows.clients.map((row) => (
            <article key={row.id} className="glass rounded-2xl p-5">
              <h2 className="font-[family-name:var(--font-syne)] text-lg">{row.company || row.name || row.leadId}</h2>
              <EvidenceChainView chain={row.chain} />
              <Link href={row.href} className="mt-3 inline-block text-sm text-emerald-300">
                View client →
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

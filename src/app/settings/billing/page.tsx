import { billingStatus } from "@/lib/billing/status";
import { usageSummary } from "@/lib/billing/ledger";
import { PageHeader } from "@/components/ui/page";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const billing = billingStatus();
  const usage = await usageSummary().catch(() => null);
  return (
    <div>
      <PageHeader
        eyebrow="Usage"
        title="Ledger and billing"
        description="Sends are counted in this service. Charges are not turned on."
      />
      <section className="glass rounded-2xl p-5">
        <p className="text-sm text-amber-100">{billing.blocker}</p>
        <dl className="mt-4 grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Charges enabled</dt>
            <dd>No</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Provider</dt>
            <dd>{billing.provider ?? "Not configured"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Email sends reserved or committed today</dt>
            <dd>{usage && usage.ok ? usage.emailSendsToday : "Ledger unavailable until the database migration is applied"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

export type BillingStatus = {
  chargesEnabled: false;
  provider: string | null;
  ledger: "local";
  blocker: string;
};

/**
 * Usage is counted locally. This build does not create Stripe customers, prices, or charges,
 * even if key-shaped environment variables are present.
 */
export function billingStatus(env: NodeJS.ProcessEnv = process.env): BillingStatus {
  const provider = (env.BILLING_PROVIDER ?? "").trim().toLowerCase();
  const hasKey = Boolean(env.STRIPE_SECRET_KEY?.trim());
  const hasPrice = Boolean(env.STRIPE_PRICE_ID?.trim());
  if (!provider && !hasKey && !hasPrice) {
    return {
      chargesEnabled: false,
      provider: null,
      ledger: "local",
      blocker:
        "No billing provider is configured. Email usage is recorded in the local ledger and capped by the existing daily send limit. Jarvis will not invent prices or charge a card. A later release can attach the existing Zar Labs Stripe account by setting BILLING_PROVIDER, STRIPE_SECRET_KEY, and STRIPE_PRICE_ID, and by shipping a reviewed charge adapter. This version still refuses to charge.",
    };
  }
  return {
    chargesEnabled: false,
    provider: provider || "stripe",
    ledger: "local",
    blocker:
      "Billing environment names are present, but this release does not call a payment provider and does not create charges, customers, or prices. Quotas still apply. Do not treat this as live billing.",
  };
}

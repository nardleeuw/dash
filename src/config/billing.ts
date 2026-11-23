/**
 * Usage-based pricing: a one-time start fee, then each month the actual
 * provider cost (Google, OpenAI, Hunter) plus the operator's markup.
 * All values are configurable with environment variables in Vercel.
 */
export const USAGE_PLAN_KEY = "usage";

const num = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) ? Number(v) : fallback);

export function billingConfig() {
  return {
    /** One-time start fee in cents (the 'usage' plan's price_cents is the source of truth for display). */
    setupFeeCents: num(process.env.BILLING_SETUP_FEE_CENTS, 50_000),
    /** Markup on provider cost, in percent (100 = customer pays 2× cost). */
    markupPercent: num(process.env.BILLING_MARKUP_PERCENT, 100),
    /** Default monthly spending cap per workspace, in cents (customers can change theirs). */
    defaultSpendCapCents: num(process.env.BILLING_DEFAULT_CAP_CENTS, 25_000),
    /** Stripe Billing Meter event name for usage in cents. */
    meterEventName: process.env.STRIPE_METER_EVENT ?? "leadwerk_usage_cents",
  };
}

/** Provider cost (cents) → amount billed to the customer (cents). */
export function billable(costCents: number, markupPercent = billingConfig().markupPercent) {
  return Math.round(costCents * (1 + markupPercent / 100));
}

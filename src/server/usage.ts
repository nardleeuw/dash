import "server-only";
import { createAdminClient } from "@/server/supabase/admin";

export type UsageKind = "search" | "enrichment" | "research" | "email_generation" | "send";

export class CreditsExhaustedError extends Error {
  constructor(public kind: UsageKind) {
    super(`credits exhausted: ${kind}`);
    this.name = "CreditsExhaustedError";
  }
}

/** Raised when the paywall is on and the workspace has no paid, active plan. */
export class PaymentRequiredError extends CreditsExhaustedError {
  constructor(kind: UsageKind) {
    super(kind);
    this.name = "PaymentRequiredError";
  }
}

/** Raised when a usage-billed workspace reached its monthly spending cap. */
export class SpendCapReachedError extends CreditsExhaustedError {
  constructor(kind: UsageKind) {
    super(kind);
    this.name = "SpendCapReachedError";
  }
}

/** Start of the current calendar month (UTC) — the usage billing period. */
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Billable usage of a workspace this month and its cap (usage plan only; null otherwise). */
export async function monthlySpend(orgId: string): Promise<{ costCents: number; billableCents: number; capCents: number } | null> {
  const { USAGE_PLAN_KEY, billable, billingConfig } = await import("@/config/billing");
  const admin = createAdminClient();
  const { data: sub } = await admin.from("subscriptions").select("plan_key, limit_overrides").eq("org_id", orgId).maybeSingle();
  if (sub?.plan_key !== USAGE_PLAN_KEY) return null;
  const { data: cost } = await admin.rpc("usage_cost_cents", { p_org: orgId, p_from: monthStart() });
  const costCents = Number(cost ?? 0);
  const cap = Number((sub.limit_overrides as { spend_cap_cents?: number } | null)?.spend_cap_cents ?? billingConfig().defaultSpendCapCents);
  return { costCents, billableCents: billable(costCents), capCents: cap };
}

/** Paywall switch (Vercel env REQUIRE_PAID_PLAN=1): only paying workspaces can use paid features. */
export function paywallEnabled() {
  return process.env.REQUIRE_PAID_PLAN === "1";
}

/**
 * Whether a workspace may use paid features: an active non-trial plan, or a
 * workspace owned by a platform admin (the operator's own account).
 */
export async function hasPaidAccess(orgId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: sub } = await admin.from("subscriptions").select("plan_key, status").eq("org_id", orgId).maybeSingle();
  if (sub && sub.plan_key !== "trial" && ["active", "trialing"].includes(sub.status)) return true;
  const { data: owners } = await admin.from("organization_members").select("user_id").eq("org_id", orgId).eq("role", "owner");
  const ids = (owners ?? []).map((o) => o.user_id as string);
  if (!ids.length) return false;
  const { count } = await admin.from("platform_admins").select("user_id", { count: "exact", head: true }).in("user_id", ids);
  return (count ?? 0) > 0;
}

/**
 * Atomically consume credits. Idempotent per key: retries of the same unit of
 * work are never billed twice. Throws CreditsExhaustedError when over limit.
 */
export async function consumeCredits(params: {
  orgId: string;
  kind: UsageKind;
  quantity?: number;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  userId?: string | null;
}) {
  if (paywallEnabled() && !(await hasPaidAccess(params.orgId))) throw new PaymentRequiredError(params.kind);
  const spend = await monthlySpend(params.orgId);
  if (spend && spend.capCents > 0 && spend.billableCents >= spend.capCents) throw new SpendCapReachedError(params.kind);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_credits", {
    p_org: params.orgId,
    p_kind: params.kind,
    p_quantity: params.quantity ?? 1,
    p_idempotency_key: params.idempotencyKey,
    p_reference_type: params.referenceType ?? null,
    p_reference_id: params.referenceId ?? null,
    p_user: params.userId ?? null,
  });
  if (error) throw error;
  if (data !== true) throw new CreditsExhaustedError(params.kind);
}

export type CreditStatus = { kind: UsageKind; used: number; allowance: number };

export async function getCreditStatus(orgId: string): Promise<CreditStatus[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("credit_status", { p_org: orgId });
  if (error) throw error;
  return ((data ?? []) as { kind: UsageKind; used: number; allowance: number }[]).map((r) => ({
    kind: r.kind,
    used: Number(r.used),
    allowance: Number(r.allowance),
  }));
}

/** Fire-and-forget provider cost/latency logging. Never throws. */
export async function logApiUsage(entry: {
  orgId?: string | null;
  provider: string;
  operation: string;
  units?: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicros?: number;
  status?: "ok" | "error" | "rate_limited" | "mock";
  latencyMs?: number;
  error?: string;
}) {
  try {
    if (process.env.APP_ENV === "test") return;
    const admin = createAdminClient();
    await admin.from("api_usage").insert({
      org_id: entry.orgId ?? null,
      provider: entry.provider,
      operation: entry.operation,
      units: entry.units ?? 1,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
      cost_micros: Math.round(entry.costMicros ?? 0),
      status: entry.status ?? "ok",
      latency_ms: entry.latencyMs ?? null,
      error: entry.error?.slice(0, 500) ?? null,
    });
  } catch (err) {
    console.warn("[api_usage] failed to log", err);
  }
}

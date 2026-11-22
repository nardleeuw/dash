import "server-only";
import { createAdminClient } from "@/server/supabase/admin";

export type UsageKind = "search" | "enrichment" | "research" | "email_generation" | "send";

export class CreditsExhaustedError extends Error {
  constructor(public kind: UsageKind) {
    super(`credits exhausted: ${kind}`);
    this.name = "CreditsExhaustedError";
  }
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

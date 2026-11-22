import "server-only";
import { ProviderError } from "./types";
import { logApiUsage } from "@/server/usage";

export type ProviderFetchOptions = {
  provider: string;
  operation: string;
  orgId?: string | null;
  costMicros?: number;
  timeoutMs?: number;
  retries?: number;
  /** Status codes returned to the caller instead of throwing (e.g. 404). */
  passThrough?: number[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch() with timeout, retry with exponential backoff + jitter on 429/5xx and
 * network errors, Retry-After support, and cost/latency logging.
 */
export async function providerFetch(url: string, init: RequestInit, opts: ProviderFetchOptions): Promise<Response> {
  const retries = opts.retries ?? 2;
  const started = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000), cache: "no-store" });
      if (res.ok || opts.passThrough?.includes(res.status)) {
        void logApiUsage({
          orgId: opts.orgId, provider: opts.provider, operation: opts.operation,
          costMicros: res.ok ? opts.costMicros : 0, status: "ok", latencyMs: Date.now() - started,
        });
        return res;
      }
      const retryable = res.status === 429 || res.status >= 500;
      const body = await res.text().catch(() => "");
      lastError = new ProviderError(opts.provider, `${opts.operation} failed with HTTP ${res.status}: ${body.slice(0, 300)}`, res.status, retryable);
      if (!retryable || attempt === retries) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : backoff(attempt));
    } catch (err) {
      lastError = err instanceof ProviderError ? err : new ProviderError(opts.provider, `${opts.operation}: ${(err as Error).message}`, undefined, true);
      if (attempt === retries) break;
      await sleep(backoff(attempt));
    }
  }

  const status = lastError instanceof ProviderError && lastError.status === 429 ? "rate_limited" : "error";
  void logApiUsage({
    orgId: opts.orgId, provider: opts.provider, operation: opts.operation, status,
    latencyMs: Date.now() - started, error: (lastError as Error)?.message,
  });
  throw lastError;
}

function backoff(attempt: number) {
  return Math.min(500 * 2 ** attempt, 5_000) + Math.floor(Math.random() * 250);
}

import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/server/supabase/admin";

export class RateLimitedError extends Error {
  constructor() {
    super("rate_limited");
    this.name = "RateLimitedError";
  }
}

/** Shared fixed-window limiter (Postgres). Fails open if the database is unreachable. */
export async function rateLimit(key: string, max: number, windowSeconds = 60) {
  // Local test runs only — never honoured in production.
  if (process.env.RATE_LIMIT_DISABLED === "1" && process.env.APP_ENV !== "production") return;
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", { p_key: key, p_window_seconds: windowSeconds, p_max: max });
    if (error) return;
    if (data === false) throw new RateLimitedError();
  } catch (err) {
    if (err instanceof RateLimitedError) throw err;
  }
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

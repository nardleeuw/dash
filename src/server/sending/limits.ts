import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailAccountRow } from "./accounts";

/** Per-account pacing: hourly/daily caps and a minimum delay between sends. */
export async function accountCapacity(admin: SupabaseClient, account: EmailAccountRow, now = new Date()): Promise<{ ok: true } | { ok: false; retryAt: Date; reason: string }> {
  if (account.last_sent_at) {
    const earliest = new Date(new Date(account.last_sent_at).getTime() + account.min_delay_seconds * 1000);
    if (earliest > now) return { ok: false, retryAt: earliest, reason: "min_delay" };
  }
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const [{ count: hour }, { count: day }] = await Promise.all([
    admin.from("outbound_messages").select("id", { count: "exact", head: true }).eq("email_account_id", account.id).gte("sent_at", hourAgo),
    admin.from("outbound_messages").select("id", { count: "exact", head: true }).eq("email_account_id", account.id).gte("sent_at", dayAgo),
  ]);
  if ((day ?? 0) >= account.daily_limit) return { ok: false, retryAt: new Date(now.getTime() + 3 * 3_600_000), reason: "daily_limit" };
  if ((hour ?? 0) >= account.hourly_limit) return { ok: false, retryAt: new Date(now.getTime() + 15 * 60_000), reason: "hourly_limit" };
  return { ok: true };
}

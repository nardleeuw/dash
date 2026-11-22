import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/server/env";

let admin: SupabaseClient | null = null;

/**
 * Service-role client — bypasses RLS. Only for background jobs, webhooks and
 * system-managed columns. Every query MUST filter by org_id explicitly.
 */
export function createAdminClient(): SupabaseClient {
  if (admin) return admin;
  const e = env();
  admin = createSupabaseClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

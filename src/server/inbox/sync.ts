import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { providerFor, type EmailAccountRow } from "@/server/sending/accounts";
import { ingestInbound } from "./ingest";

/** Poll every connected mailbox for new inbound messages. */
export async function syncAllMailboxes() {
  const admin = createAdminClient();
  const { data: accounts } = await admin.from("email_accounts").select("*").in("status", ["active", "paused"]).neq("provider", "mock");
  const results: Record<string, unknown> = {};
  for (const account of (accounts ?? []) as EmailAccountRow[]) {
    if (account.provider === "smtp" && !account.imap_host) continue;
    try {
      const { data: state } = await admin.from("email_account_sync_state").select("cursor").eq("email_account_id", account.id).maybeSingle();
      const provider = await providerFor(admin, account);
      if (!provider.fetchInbound) continue;
      const { messages, cursor } = await provider.fetchInbound((state?.cursor ?? {}) as Record<string, unknown>);
      let ingested = 0;
      for (const m of messages) {
        const r = await ingestInbound(account.org_id, account.id, m).catch((err) => ({ error: (err as Error).message }));
        if ("replyId" in r || "bounce" in r) ingested++;
      }
      await admin.from("email_account_sync_state").upsert({ email_account_id: account.id, org_id: account.org_id, cursor, last_synced_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() });
      results[account.id] = { fetched: messages.length, ingested };
    } catch (err) {
      await admin.from("email_account_sync_state").upsert({ email_account_id: account.id, org_id: account.org_id, last_error: (err as Error).message.slice(0, 300), updated_at: new Date().toISOString() });
      results[account.id] = { error: (err as Error).message };
    }
  }
  return results;
}

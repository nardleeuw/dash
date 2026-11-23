import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { findBusinessEmails } from "./finder";

/**
 * Cron safety net: businesses with a website but no email address that were
 * never looked up (or not in the last 7 days) get an address lookup. Keeps
 * large imports filling up with addresses over the following minutes.
 */
export async function backfillContacts(budgetMs = 90_000) {
  const started = Date.now();
  const admin = createAdminClient();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: candidates } = await admin
    .from("businesses")
    .select("id, org_id, contacts(id)")
    .not("website_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  const todo = (candidates ?? []).filter((b) => !(b.contacts as unknown[] | null)?.length);
  if (!todo.length) return { looked_up: 0 };
  const { data: recent } = await admin.from("activities").select("business_id").eq("type", "contacts_found").gte("created_at", since).in("business_id", todo.map((b) => b.id));
  const done = new Set((recent ?? []).map((r) => r.business_id));
  const queue = todo.filter((b) => !done.has(b.id)).slice(0, 40);
  const blockedOrgs = new Set<string>();
  let lookedUp = 0;
  const worker = async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      if (Date.now() - started > budgetMs) return;
      if (blockedOrgs.has(b.org_id)) continue;
      try {
        await findBusinessEmails(b.org_id, null, b.id);
        lookedUp++;
      } catch (err) {
        const name = (err as Error).name;
        if (["CreditsExhaustedError", "PaymentRequiredError", "SpendCapReachedError"].includes(name)) blockedOrgs.add(b.org_id);
        else console.error("[contacts] backfill failed", b.id, (err as Error).message);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { looked_up: lookedUp };
}

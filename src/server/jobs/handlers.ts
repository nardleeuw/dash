import "server-only";
import type { JobEvents, JobName } from "./events";
import { importGroup } from "@/server/discovery/import";
import { createAdminClient } from "@/server/supabase/admin";
import { purgeExpiredData } from "@/server/compliance/retention";

type HandlerMap = { [N in JobName]?: (data: JobEvents[N]) => Promise<unknown> };

/**
 * Plain async handlers shared by Inngest functions and the inline runner.
 * Each must be idempotent: it may be retried. Later phases register more.
 */
export const handlers: HandlerMap = {
  "discovery/import.requested": async ({ orgId, userId, groups, listId }) => {
    const outcomes = [];
    for (const g of groups) {
      const o = await importGroup(orgId, userId, g);
      outcomes.push(o);
      if (listId && o.businessId) {
        await createAdminClient()
          .from("lead_list_members")
          .upsert({ org_id: orgId, list_id: listId, business_id: o.businessId, added_by: userId }, { onConflict: "list_id,business_id", ignoreDuplicates: true });
      }
    }
    return outcomes;
  },
  "retention/purge": async () => purgeExpiredData(),
  "emails/resume": async () => (await import("@/server/emails/batch")).resumeStaleGeneration(),
  "contacts/bulk.requested": async ({ orgId, userId, businessIds }) => {
    const { findBusinessEmails } = await import("@/server/contacts/finder");
    const queue = [...businessIds];
    let found = 0;
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          const r = await findBusinessEmails(orgId, userId, id);
          if (!("error" in r)) found += r.added;
        } catch (err) {
          if ((err as Error).name === "CreditsExhaustedError") return;
          console.error("[contacts] bulk lookup failed", id, (err as Error).message);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { found };
  },
  "research/business.requested": async (data) => (await import("@/server/research/run")).runResearch(data),
  "campaigns/tick": async () => (await import("@/server/sending/tick")).campaignTick(),
  "inbox/sync": async () => (await import("@/server/inbox/sync")).syncAllMailboxes(),
  "emails/batch.created": async (data) => (await import("@/server/emails/batch")).planBatch(data),
  "emails/generate.requested": async (data) => {
    const { generateEmailById } = await import("@/server/emails/generate");
    const res = await generateEmailById(data.orgId, data.emailId);
    const { createAdminClient } = await import("@/server/supabase/admin");
    const { data: row } = await createAdminClient().from("generated_emails").select("batch_id").eq("id", data.emailId).single();
    if (row?.batch_id) await (await import("@/server/emails/batch")).finalizeBatch(data.orgId, row.batch_id);
    return res;
  },
};

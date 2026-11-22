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
  "research/business.requested": async (data) => (await import("@/server/research/run")).runResearch(data),
};

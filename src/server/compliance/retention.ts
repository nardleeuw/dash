import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { recomputeBusiness } from "@/server/discovery/import";

/**
 * Enforce provider retention rules: expired attributes (e.g. Google Places
 * content after 30 days) are deleted and golden records are recomputed from
 * the remaining sources. Idempotent; safe to run repeatedly.
 */
export async function purgeExpiredData() {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  let purgedAttributes = 0;
  const affected = new Map<string, string>(); // businessId -> orgId

  for (;;) {
    const { data, error } = await admin
      .from("business_attributes")
      .select("id, business_id, org_id")
      .lt("expires_at", now)
      .limit(500);
    if (error) throw error;
    if (!data?.length) break;
    data.forEach((r) => affected.set(r.business_id, r.org_id));
    const { error: delErr } = await admin.from("business_attributes").delete().in("id", data.map((r) => r.id));
    if (delErr) throw delErr;
    purgedAttributes += data.length;
    if (data.length < 500) break;
  }

  await admin.from("business_sources").delete().lt("expires_at", now);
  await admin.from("business_locations").update({ geo_expires_at: null }).lt("geo_expires_at", now);

  for (const [businessId, orgId] of affected) {
    await recomputeBusiness(admin, orgId, businessId);
  }
  return { purgedAttributes, recomputed: affected.size };
}

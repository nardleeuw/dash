import type { ImportGroup } from "@/server/discovery/import";

/** Background job events and their payloads. */
export type JobEvents = {
  "discovery/import.requested": { orgId: string; userId: string | null; groups: ImportGroup[]; listId?: string | null };
  "research/business.requested": { orgId: string; userId: string | null; businessId: string; analysisId: string };
  "emails/batch.created": { orgId: string; userId: string | null; batchId: string };
  "emails/generate.requested": { orgId: string; emailId: string };
  "contacts/bulk.requested": { orgId: string; userId: string | null; businessIds: string[] };
  "emails/resume": Record<string, never>;
  "billing/report-usage": Record<string, never>;
  "campaigns/tick": Record<string, never>;
  "inbox/sync": Record<string, never>;
  "retention/purge": Record<string, never>;
};

export type JobName = keyof JobEvents;

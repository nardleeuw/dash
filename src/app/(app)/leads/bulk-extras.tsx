"use client";

/**
 * Extension point for bulk actions added by later phases (AI research,
 * email generation). Renders nothing until those features register here.
 */
export function LeadBulkExtras(_props: { ids: string[]; onDone: () => void }) {
  return null;
}

import "server-only";
import { inngest } from "./client";
import { handlers } from "./handlers";
import type { JobEvents, JobName } from "./events";

type FnConfig = {
  id: string;
  event?: JobName;
  cron?: string;
  retries?: number;
  concurrency?: [{ limit: number; key?: string }] | [{ limit: number; key?: string }, { limit: number; key?: string }];
};

/** Concurrency keys per organization keep one tenant from starving others. */
const CONFIG: FnConfig[] = [
  { id: "discovery-import", event: "discovery/import.requested", retries: 3, concurrency: [{ limit: 2, key: "event.data.orgId" }] },
  { id: "research-business", event: "research/business.requested", retries: 3, concurrency: [{ limit: 3, key: "event.data.orgId" }, { limit: 10 }] },
  { id: "emails-plan-batch", event: "emails/batch.created", retries: 3 },
  { id: "emails-generate", event: "emails/generate.requested", retries: 3, concurrency: [{ limit: 4, key: "event.data.orgId" }, { limit: 12 }] },
  { id: "campaigns-tick", cron: "* * * * *", retries: 1, concurrency: [{ limit: 1 }] },
  { id: "inbox-sync", cron: "*/5 * * * *", retries: 1, concurrency: [{ limit: 1 }] },
  { id: "retention-purge", cron: "17 3 * * *", retries: 2, concurrency: [{ limit: 1 }] },
];

const CRON_EVENT: Record<string, JobName> = {
  "campaigns-tick": "campaigns/tick",
  "inbox-sync": "inbox/sync",
  "retention-purge": "retention/purge",
};

export const functions = CONFIG.flatMap((cfg) => {
  const name = cfg.event ?? CRON_EVENT[cfg.id];
  const handler = handlers[name] as ((d: JobEvents[JobName]) => Promise<unknown>) | undefined;
  if (!handler) return [];
  return [
    inngest.createFunction(
      {
        id: cfg.id,
        retries: (cfg.retries ?? 3) as 0 | 1 | 2 | 3,
        concurrency: cfg.concurrency,
        triggers: cfg.cron ? [{ cron: cfg.cron }] : [{ event: name }],
      },
      async ({ event, step }) => step.run(cfg.id, () => handler((event?.data ?? {}) as JobEvents[JobName]) as Promise<unknown> as Promise<null>),
    ),
  ];
});

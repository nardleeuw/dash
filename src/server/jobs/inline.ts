import "server-only";
import type { JobEvents, JobName } from "./events";
import { handlers } from "./handlers";

/** Run a job handler in-process (no durable retries — dev/fallback only). */
export async function runInline<N extends JobName>(name: N, data: JobEvents[N]) {
  const handler = handlers[name] as ((d: JobEvents[N]) => Promise<unknown>) | undefined;
  if (!handler) throw new Error(`no handler registered for ${name}`);
  return handler(data);
}

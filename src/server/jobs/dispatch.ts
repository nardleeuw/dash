import "server-only";
import { after } from "next/server";
import { inngest, inngestEnabled } from "./client";
import type { JobEvents, JobName } from "./events";
import { runInline } from "./inline";

/**
 * Enqueue a background job. Uses Inngest when configured; otherwise runs the
 * same handler in-process after the response is sent (local development and
 * small self-hosted installs).
 */
export async function dispatch<N extends JobName>(name: N, data: JobEvents[N]) {
  if (process.env.JOBS_DISABLED === "1") return; // tests drive jobs explicitly
  if (inngestEnabled()) {
    await inngest.send({ name, data });
    return;
  }
  if (process.env.APP_ENV === "production") {
    console.warn(`[jobs] Inngest not configured in production — running ${name} inline`);
  }
  const run = async () => {
    try {
      await runInline(name, data);
    } catch (err) {
      console.error(`[jobs] inline ${name} failed`, err);
    }
  };
  try {
    after(run);
  } catch {
    // Outside a request scope (scripts, cron): run detached.
    void run();
  }
}

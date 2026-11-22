/**
 * Local scheduler: when Inngest is not configured (development), run the
 * periodic jobs in-process. Production uses Inngest or Vercel Cron instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV || process.env.APP_ENV === "production" || process.env.LOCAL_SCHEDULER === "0") return;
  const g = globalThis as unknown as { __lwScheduler?: boolean };
  if (g.__lwScheduler) return;
  g.__lwScheduler = true;
  const { runInline } = await import("./server/jobs/inline");
  const { handlers } = await import("./server/jobs/handlers");
  const every = (ms: number, name: "campaigns/tick" | "inbox/sync" | "retention/purge") =>
    setInterval(() => {
      if (!handlers[name]) return;
      runInline(name, {}).catch((err) => console.error(`[scheduler] ${name}`, (err as Error).message));
    }, ms).unref?.();
  every(60_000, "campaigns/tick");
  every(5 * 60_000, "inbox/sync");
  every(24 * 60 * 60_000, "retention/purge");
  console.log("[scheduler] local scheduler started (campaign tick 60s, inbox 5m, retention 24h)");
}

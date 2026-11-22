import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runInline } from "@/server/jobs/inline";
import { inngestEnabled } from "@/server/jobs/client";

export const maxDuration = 300;

const JOBS = { "campaigns-tick": "campaigns/tick", "inbox-sync": "inbox/sync", "retention-purge": "retention/purge" } as const;

/** Vercel Cron fallback when Inngest is not used. Requires Authorization: Bearer CRON_SECRET. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/cron/[job]">) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (inngestEnabled()) return NextResponse.json({ skipped: "inngest_enabled" });
  const { job } = await ctx.params;
  const name = JOBS[job as keyof typeof JOBS];
  if (!name) return NextResponse.json({ error: "unknown_job" }, { status: 404 });
  const result = await runInline(name, {});
  return NextResponse.json({ job, result });
}

import { NextResponse, type NextRequest } from "next/server";
import { handleUnsubscribe } from "@/server/compliance/unsubscribe-handler";
import { clientIp, rateLimit, RateLimitedError } from "@/server/rate-limit";

/** RFC 8058 one-click unsubscribe (POST from mail clients). */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  try {
    await rateLimit(`unsub:${await clientIp()}`, 60);
  } catch (err) {
    if (err instanceof RateLimitedError) return new NextResponse("rate limited", { status: 429 });
  }
  const res = await handleUnsubscribe(decodeURIComponent(token), "one_click");
  return new NextResponse(res.ok ? "unsubscribed" : "invalid", { status: res.ok ? 200 : 400 });
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/u/${token}`, req.url));
}

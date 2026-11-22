import { NextResponse, type NextRequest } from "next/server";
import { handleUnsubscribe } from "@/server/compliance/unsubscribe-handler";

/** RFC 8058 one-click unsubscribe (POST from mail clients). */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  const res = await handleUnsubscribe(decodeURIComponent(token), "one_click");
  return new NextResponse(res.ok ? "unsubscribed" : "invalid", { status: res.ok ? 200 : 400 });
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/u/${token}`, req.url));
}

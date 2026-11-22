import { NextResponse, type NextRequest } from "next/server";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireRole } from "@/server/auth";
import { OAUTH, oauthConfigured, type OAuthProvider } from "@/server/sending/providers/oauth";
import { env } from "@/server/env";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/oauth/[provider]/start">) {
  const { provider } = await ctx.params;
  if (provider !== "google" && provider !== "microsoft") return NextResponse.json({ error: "unknown_provider" }, { status: 404 });
  const p = provider as OAuthProvider;
  if (!oauthConfigured(p)) return NextResponse.json({ error: "not_configured" }, { status: 501 });
  const ws = await requireRole("admin");
  const nonce = randomBytes(16).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ o: ws.org.id, u: ws.user.id, n: nonce })).toString("base64url");
  const sig = createHmac("sha256", env().ENCRYPTION_KEY ?? "").update(payload).digest("base64url");
  (await cookies()).set("lw_oauth_nonce", nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  const url = new URL(OAUTH[p].authUrl);
  url.searchParams.set("client_id", OAUTH[p].clientId()!);
  url.searchParams.set("redirect_uri", `${env().APP_URL}/api/oauth/${p}/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH[p].scope);
  url.searchParams.set("state", `${payload}.${sig}`);
  if (p === "google") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  return NextResponse.redirect(url);
}

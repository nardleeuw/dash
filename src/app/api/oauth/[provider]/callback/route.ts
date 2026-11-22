import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { requireRole } from "@/server/auth";
import { createAdminClient } from "@/server/supabase/admin";
import { exchangeCode, type OAuthProvider } from "@/server/sending/providers/oauth";
import { encryptJson } from "@/server/crypto";
import { env } from "@/server/env";

function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string; preferred_username?: string };
    return (claims.email ?? claims.preferred_username ?? null)?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/oauth/[provider]/callback">) {
  const { provider } = await ctx.params;
  const p = provider as OAuthProvider;
  const fail = (code: string) => NextResponse.redirect(new URL(`/integrations?error=${code}`, req.url));
  if (p !== "google" && p !== "microsoft") return fail("unknown_provider");
  const ws = await requireRole("admin");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const [payload, sig] = state.split(".");
  const expected = createHmac("sha256", env().ENCRYPTION_KEY ?? "").update(payload ?? "").digest();
  const given = Buffer.from(sig ?? "", "base64url");
  if (!code || !payload || given.length !== expected.length || !timingSafeEqual(given, expected)) return fail("invalid_state");
  const st = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { o: string; u: string; n: string };
  const nonce = (await cookies()).get("lw_oauth_nonce")?.value;
  if (st.o !== ws.org.id || st.u !== ws.user.id || !nonce || nonce !== st.n) return fail("invalid_state");

  const tokens = await exchangeCode(p, code, `${env().APP_URL}/api/oauth/${p}/callback`).catch(() => null);
  if (!tokens?.refresh_token) return fail("token_exchange");
  const email = emailFromIdToken(tokens.id_token);
  if (!email) return fail("no_email");
  const admin = createAdminClient();
  const { data: account, error } = await admin
    .from("email_accounts")
    .upsert({ org_id: ws.org.id, provider: p === "google" ? "gmail" : "microsoft", email_address: email, status: "active", created_by: ws.user.id }, { onConflict: "org_id,email_address" })
    .select("id")
    .single();
  if (error || !account) return fail("save_failed");
  const { id_token: _ignored, ...store } = tokens;
  await admin.from("email_account_secrets").upsert({ email_account_id: account.id, ciphertext: encryptJson(store), updated_at: new Date().toISOString() });
  return NextResponse.redirect(new URL("/integrations?connected=1", req.url));
}

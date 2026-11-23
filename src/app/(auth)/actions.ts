"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { env } from "@/server/env";
import { getLocale } from "@/i18n/server";
import { safeNext } from "@/lib/safe-redirect";
import { clientIp, rateLimit, RateLimitedError } from "@/server/rate-limit";

async function limited(bucket: string, max: number) {
  try {
    await rateLimit(`auth:${bucket}:${await clientIp()}`, max, 600);
    return false;
  } catch (err) {
    if (err instanceof RateLimitedError) return true;
    throw err;
  }
}

export type AuthState = { error?: string; message?: string } | undefined;

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(200),
});

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "invalidCredentials" };
  if (await limited("login", 20)) return { error: "rate_limited" };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "invalidCredentials" };
  redirect(safeNext(formData.get("next") as string | null));
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const schema = credentials.extend({ fullName: z.string().trim().min(1).max(120) });
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) {
    const pw = parsed.error.issues.some((i) => i.path[0] === "password");
    return { error: pw ? "weakPassword" : "validation" };
  }
  if (await limited("signup", 10)) return { error: "rate_limited" };
  const supabase = await createClient();
  const locale = await getLocale();
  const plan = z.enum(["starter", "growth", "pro"]).safeParse(formData.get("plan"));
  const afterSignup = plan.success ? `/onboarding?plan=${plan.data}` : "/onboarding";
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${env().APP_URL}/auth/confirm?next=${encodeURIComponent(afterSignup)}`,
      data: { full_name: parsed.data.fullName, locale },
    },
  });
  if (error) {
    if (/already/i.test(error.message)) return { error: "emailTaken" };
    if (/password/i.test(error.message)) return { error: "weakPassword" };
    console.error("[signup]", error.message);
    return { error: "unexpected" };
  }
  if (data.session) redirect(safeNext(formData.get("next") as string | null, afterSignup));
  return { message: "checkEmail" };
}

export async function requestResetAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (email.success && !(await limited("reset", 5))) {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email.data, {
      redirectTo: `${env().APP_URL}/auth/callback?next=/reset-password`,
    });
  }
  // Same response whether or not the account exists (no user enumeration).
  return { message: "resetSent" };
}

export async function updatePasswordAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = z.string().min(10).max(200).safeParse(formData.get("password"));
  if (!password.success) return { error: "weakPassword" };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) return { error: "unexpected" };
  redirect("/overview");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

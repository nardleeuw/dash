"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/server/supabase/server";
import { ACTIVE_ORG_COOKIE, getWorkspace, requireUser } from "@/server/auth";
import { LOCALE_COOKIE } from "@/i18n/server";

function slugify(input: string) {
  return (
    input
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace"
  ).padEnd(2, "0");
}

export type OnboardingState = { error?: string } | undefined;

export async function createWorkspaceAction(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  await requireUser();
  const name = z.string().trim().min(1).max(120).safeParse(formData.get("name"));
  if (!name.success) return { error: "validation" };
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("create_organization", { p_name: name.data, p_slug: slugify(name.data) });
  if (error || !orgId) {
    console.error("[create_organization]", error?.message);
    return { error: "unexpected" };
  }
  (await cookies()).set(ACTIVE_ORG_COOKIE, String(orgId), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  const plan = z.enum(["usage", "starter", "growth", "pro"]).safeParse(formData.get("plan"));
  redirect(plan.success ? `/billing?plan=${plan.data}` : "/overview");
}

export async function switchWorkspaceAction(orgId: string) {
  const ws = await getWorkspace();
  if (!ws.memberships.some((m) => m.orgId === orgId)) return;
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  redirect("/overview");
}

export async function setLocaleAction(locale: "nl" | "en") {
  const value = locale === "en" ? "en" : "nl";
  (await cookies()).set(LOCALE_COOKIE, value, { sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) await supabase.from("users").update({ locale: value }).eq("id", data.user.id);
  revalidatePath("/", "layout");
}

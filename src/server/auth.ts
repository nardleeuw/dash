import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/server/supabase/server";

export const ROLES = ["owner", "admin", "manager", "sales_rep", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = { owner: 50, admin: 40, manager: 30, sales_rep: 20, viewer: 10 };

export function hasMinRole(role: Role, min: Role) {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export const ACTIVE_ORG_COOKIE = "lw_org";

export type SessionUser = { id: string; email: string; fullName: string | null; locale: "nl" | "en" };

export type Membership = { orgId: string; orgName: string; orgSlug: string; role: Role };

export type WorkspaceContext = {
  user: SessionUser;
  org: { id: string; name: string; slug: string; locale: "nl" | "en"; settings: Record<string, unknown> };
  role: Role;
  memberships: Membership[];
  isPlatformAdmin: boolean;
};

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Current authenticated user (validated against Supabase Auth), or null. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile } = await supabase
    .from("users")
    .select("email, full_name, locale")
    .eq("id", data.user.id)
    .maybeSingle();
  return {
    id: data.user.id,
    email: profile?.email ?? data.user.email ?? "",
    fullName: profile?.full_name ?? null,
    locale: profile?.locale === "en" ? "en" : "nl",
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Workspace context for the active organization; redirects when absent. */
export const getWorkspace = cache(async (): Promise<WorkspaceContext> => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("organization_members")
    .select("role, organizations!inner(id, name, slug, locale, settings)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw error;

  type Row = { role: Role; organizations: { id: string; name: string; slug: string; locale: string; settings: Record<string, unknown> } };
  const memberships = ((rows ?? []) as unknown as Row[]).map((r) => ({
    orgId: r.organizations.id,
    orgName: r.organizations.name,
    orgSlug: r.organizations.slug,
    role: r.role,
    org: r.organizations,
  }));
  if (memberships.length === 0) redirect("/onboarding");

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.orgId === preferred) ?? memberships[0];

  const { data: adminRow } = await supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();

  return {
    user,
    org: {
      id: active.org.id,
      name: active.org.name,
      slug: active.org.slug,
      locale: active.org.locale === "en" ? "en" : "nl",
      settings: active.org.settings ?? {},
    },
    role: active.role,
    memberships: memberships.map(({ orgId, orgName, orgSlug, role }) => ({ orgId, orgName, orgSlug, role })),
    isPlatformAdmin: Boolean(adminRow),
  };
});

/** Use in Server Actions / Route Handlers: verifies role, throws otherwise. */
export async function requireRole(min: Role): Promise<WorkspaceContext> {
  const ws = await getWorkspace();
  if (!hasMinRole(ws.role, min)) throw new ForbiddenError(`requires role ${min}`);
  return ws;
}

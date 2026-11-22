import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
export const anon = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

export type TestUser = { id: string; email: string; client: SupabaseClient };

export async function createTestUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@test.leadwerk.local`;
  const password = "correct-horse-battery-staple";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: label } });
  if (error) throw error;
  const client = anon();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user!.id, email, client };
}

export async function createOrgFor(user: TestUser, name: string): Promise<string> {
  const { data, error } = await user.client.rpc("create_organization", { p_name: name, p_slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") });
  if (error) throw error;
  return data as string;
}

export async function addMember(orgId: string, user: TestUser, role: string) {
  const { error } = await admin.from("organization_members").insert({ org_id: orgId, user_id: user.id, role });
  if (error) throw error;
}

export async function insertBusiness(orgId: string, name: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await admin.from("businesses").insert({ org_id: orgId, name, ...extra }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

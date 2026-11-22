"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { ok, safeAction, type ActionResult } from "@/server/actions";

export async function createClientAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const ws = await requireRole("manager");
    const p = z.object({
      name: z.string().trim().min(1).max(120),
      website: z.string().trim().max(200).optional(),
      description: z.string().trim().max(2000).optional(),
      contact_email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
    }).parse(input);
    const supabase = await createClient();
    const { data: client, error } = await supabase.from("agency_clients").insert({ org_id: ws.org.id, name: p.name, website: p.website || null, description: p.description || null, contact_email: p.contact_email || null, created_by: ws.user.id }).select("id").single();
    if (error) throw error;
    // Each client gets its own sender profile, seeded from the agency's defaults.
    const { data: base } = await supabase.from("agency_profiles").select("*").eq("org_id", ws.org.id).is("client_id", null).maybeSingle();
    const { id: _id, created_at: _c, updated_at: _u, client_id: _cl, ...rest } = (base ?? {}) as Record<string, unknown>;
    await supabase.from("agency_profiles").insert({ ...rest, org_id: ws.org.id, client_id: client.id, agency_name: base?.agency_name ?? ws.org.name, description: p.description || base?.description || null, website: base?.website ?? null });
    revalidatePath("/clients");
    return ok({ id: client.id });
  });
}

export async function archiveClientAction(id: unknown, archived: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("manager");
    const supabase = await createClient();
    await supabase.from("agency_clients").update({ is_archived: z.boolean().parse(archived) }).eq("id", z.string().uuid().parse(id)).eq("org_id", ws.org.id);
    revalidatePath("/clients");
    return ok(null);
  });
}

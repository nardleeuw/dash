"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { fail, ok, safeAction, type ActionResult } from "@/server/actions";
import { classifyEmail } from "@/server/discovery/normalize";

const ids = z.array(z.string().uuid()).min(1).max(1000);
const LEAD_STATUSES = ["new", "enriched", "qualified", "approved", "contacted", "replied", "interested", "meeting_booked", "customer", "not_interested", "suppressed"] as const;

export async function setLeadStatusAction(businessIds: unknown, status: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const list = ids.parse(businessIds);
    const s = z.enum(LEAD_STATUSES).parse(status);
    const supabase = await createClient();
    const { error } = await supabase.from("businesses").update({ lead_status: s }).eq("org_id", ws.org.id).in("id", list);
    if (error) throw error;
    await supabase.from("activities").insert(list.map((id) => ({ org_id: ws.org.id, business_id: id, actor_id: ws.user.id, type: "status_changed", data: { status: s } })));
    revalidatePath("/leads");
    revalidatePath("/crm");
    return ok(null);
  });
}

export async function createListAction(name: unknown, clientId?: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const n = z.string().trim().min(1).max(120).parse(name);
    const c = z.string().uuid().nullable().optional().parse(clientId ?? null);
    const supabase = await createClient();
    const { data, error } = await supabase.from("lead_lists").insert({ org_id: ws.org.id, name: n, client_id: c, created_by: ws.user.id }).select("id").single();
    if (error) throw error;
    revalidatePath("/leads");
    return ok({ id: data.id });
  });
}

export async function addToListAction(businessIds: unknown, listId: unknown): Promise<ActionResult<{ added: number }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const list = ids.parse(businessIds);
    const l = z.string().uuid().parse(listId);
    const supabase = await createClient();
    const rows = list.map((id) => ({ org_id: ws.org.id, list_id: l, business_id: id, added_by: ws.user.id }));
    const { error } = await supabase.from("lead_list_members").upsert(rows, { onConflict: "list_id,business_id", ignoreDuplicates: true });
    if (error) throw error;
    revalidatePath("/leads");
    return ok({ added: rows.length });
  });
}

export async function removeFromListAction(businessIds: unknown, listId: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const list = ids.parse(businessIds);
    const l = z.string().uuid().parse(listId);
    const supabase = await createClient();
    await supabase.from("lead_list_members").delete().eq("org_id", ws.org.id).eq("list_id", l).in("business_id", list);
    revalidatePath("/leads");
    return ok(null);
  });
}

export async function deleteBusinessesAction(businessIds: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("manager");
    const list = ids.parse(businessIds);
    const supabase = await createClient();
    const { error } = await supabase.from("businesses").delete().eq("org_id", ws.org.id).in("id", list);
    if (error) throw error;
    revalidatePath("/leads");
    return ok(null);
  });
}

export async function assignBusinessAction(businessId: unknown, userId: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const b = z.string().uuid().parse(businessId);
    const u = z.string().uuid().nullable().parse(userId);
    const supabase = await createClient();
    if (u) {
      const { data } = await supabase.from("organization_members").select("id").eq("org_id", ws.org.id).eq("user_id", u).maybeSingle();
      if (!data) return fail("forbidden");
    }
    await supabase.from("businesses").update({ assigned_to: u }).eq("id", b).eq("org_id", ws.org.id);
    revalidatePath(`/leads/${b}`);
    return ok(null);
  });
}

export async function setTagsAction(businessId: unknown, tags: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const b = z.string().uuid().parse(businessId);
    const tg = z.array(z.string().trim().min(1).max(40)).max(20).parse(tags);
    const supabase = await createClient();
    await supabase.from("businesses").update({ tags: [...new Set(tg)] }).eq("id", b).eq("org_id", ws.org.id);
    revalidatePath(`/leads/${b}`);
    return ok(null);
  });
}

const contactSchema = z.object({
  fullName: z.string().trim().max(160).optional(),
  jobTitle: z.string().trim().max(160).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  recipientCategory: z.enum(["natural_person", "sole_trader", "legal_entity_personal", "legal_entity_generic", "unknown"]),
});

export async function addContactAction(businessId: unknown, input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const b = z.string().uuid().parse(businessId);
    const c = contactSchema.parse(input);
    const supabase = await createClient();
    const email = c.email || null;
    const type = email ? classifyEmail(email) : "unknown";
    const [first, ...rest] = (c.fullName ?? "").split(" ");
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        org_id: ws.org.id, business_id: b, full_name: c.fullName || null, first_name: first || null, last_name: rest.join(" ") || null,
        job_title: c.jobTitle || null, email, phone: c.phone || null, source: "manual", created_by: ws.user.id,
        email_type: type === "generic" ? "generic" : type === "personal" ? "personal" : "unknown",
        recipient_category: c.recipientCategory,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return fail("duplicate");
      throw error;
    }
    await supabase.from("contact_sources").insert({ org_id: ws.org.id, contact_id: data.id, provider: "manual" });
    revalidatePath(`/leads/${b}`);
    return ok({ id: data.id });
  });
}

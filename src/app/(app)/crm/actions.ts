"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { fail, ok, safeAction, type ActionResult } from "@/server/actions";

const uuid = z.string().uuid();

export async function createTaskAction(input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const p = z.object({ title: z.string().trim().min(1).max(300), businessId: uuid.nullable().optional(), dueAt: z.string().datetime().nullable().optional(), assigneeId: uuid.nullable().optional(), description: z.string().trim().max(2000).optional() }).parse(input);
    const supabase = await createClient();
    if (p.assigneeId) {
      const { data } = await supabase.from("organization_members").select("id").eq("org_id", ws.org.id).eq("user_id", p.assigneeId).maybeSingle();
      if (!data) return fail("forbidden");
    }
    const { error } = await supabase.from("tasks").insert({ org_id: ws.org.id, title: p.title, description: p.description || null, business_id: p.businessId ?? null, due_at: p.dueAt ?? null, assignee_id: p.assigneeId ?? ws.user.id, created_by: ws.user.id });
    if (error) throw error;
    if (p.businessId) await supabase.from("activities").insert({ org_id: ws.org.id, business_id: p.businessId, actor_id: ws.user.id, type: "task_created", data: { title: p.title } });
    revalidatePath("/crm");
    if (p.businessId) revalidatePath(`/leads/${p.businessId}`);
    return ok(null);
  });
}

export async function setTaskStatusAction(id: unknown, done: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const d = z.boolean().parse(done);
    const supabase = await createClient();
    await supabase.from("tasks").update({ status: d ? "done" : "open", completed_at: d ? new Date().toISOString() : null }).eq("id", uuid.parse(id)).eq("org_id", ws.org.id);
    revalidatePath("/crm");
    return ok(null);
  });
}

export async function deleteTaskAction(id: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const supabase = await createClient();
    await supabase.from("tasks").delete().eq("id", uuid.parse(id)).eq("org_id", ws.org.id);
    revalidatePath("/crm");
    return ok(null);
  });
}

export async function addNoteAction(businessId: unknown, body: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const b = uuid.parse(businessId);
    const text = z.string().trim().min(1).max(20000).parse(body);
    const supabase = await createClient();
    const { error } = await supabase.from("notes").insert({ org_id: ws.org.id, business_id: b, body: text, created_by: ws.user.id });
    if (error) throw error;
    await supabase.from("activities").insert({ org_id: ws.org.id, business_id: b, actor_id: ws.user.id, type: "note_added", data: {} });
    revalidatePath(`/leads/${b}`);
    return ok(null);
  });
}

export async function deleteNoteAction(id: unknown, businessId: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const supabase = await createClient();
    await supabase.from("notes").delete().eq("id", uuid.parse(id)).eq("org_id", ws.org.id);
    revalidatePath(`/leads/${uuid.parse(businessId)}`);
    return ok(null);
  });
}

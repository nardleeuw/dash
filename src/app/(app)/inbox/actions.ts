"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { createAdminClient } from "@/server/supabase/admin";
import { fail, ok, safeAction, type ActionResult } from "@/server/actions";
import { draftConversationReply, sendConversationReply } from "@/server/inbox/reply";
import { ingestInbound } from "@/server/inbox/ingest";
import { syncAllMailboxes } from "@/server/inbox/sync";
import { isProduction } from "@/server/env";
import { SendError } from "@/server/sending/providers/types";
import { rateLimit } from "@/server/rate-limit";

const uuid = z.string().uuid();

export async function sendReplyAction(conversationId: unknown, body: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const id = uuid.parse(conversationId);
    const text = z.string().trim().min(2).max(8000).parse(body);
    const supabase = await createClient();
    const { data: conv } = await supabase.from("conversations").select("id").eq("id", id).eq("org_id", ws.org.id).maybeSingle();
    if (!conv) return fail("notFound");
    try {
      const res = await sendConversationReply(ws.org.id, ws.user.id, id, text);
      if ("error" in res && res.error) return fail(res.error);
    } catch (err) {
      if (err instanceof SendError) return fail(`send:${err.kind}`);
      throw err;
    }
    revalidatePath("/inbox");
    return ok(null);
  });
}

export async function draftReplyAction(conversationId: unknown): Promise<ActionResult<{ body: string; isMock: boolean }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const id = uuid.parse(conversationId);
    await rateLimit(`draft:${ws.org.id}`, 30);
    const supabase = await createClient();
    const { data: conv } = await supabase.from("conversations").select("id").eq("id", id).eq("org_id", ws.org.id).maybeSingle();
    if (!conv) return fail("notFound");
    return ok(await draftConversationReply(ws.org.id, id));
  });
}

export async function updateConversationAction(conversationId: unknown, input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    const id = uuid.parse(conversationId);
    const p = z.object({
      needs_attention: z.boolean().optional(),
      status: z.enum(["open", "closed"]).optional(),
      latest_category: z.enum(["interested", "meeting_request", "more_info", "not_interested", "follow_up_later", "out_of_office", "unsubscribe", "complaint", "unknown"]).optional(),
    }).parse(input);
    const supabase = await createClient();
    const { error } = await supabase.from("conversations").update(p).eq("id", id).eq("org_id", ws.org.id);
    if (error) throw error;
    revalidatePath("/inbox");
    return ok(null);
  });
}

export async function syncInboxAction(): Promise<ActionResult<null>> {
  return safeAction(async () => {
    await requireRole("sales_rep");
    await syncAllMailboxes();
    revalidatePath("/inbox");
    return ok(null);
  });
}

/** Development/demo only: simulate an inbound reply on a mock account. */
export async function simulateReplyAction(recipientId: unknown, text: unknown): Promise<ActionResult<{ category: string }>> {
  return safeAction(async () => {
    const ws = await requireRole("sales_rep");
    if (isProduction()) return fail("forbidden");
    const rid = uuid.parse(recipientId);
    const body = z.string().trim().min(2).max(4000).parse(text);
    const admin = createAdminClient();
    const { data: out } = await admin.from("outbound_messages").select("message_id_header, to_email, email_account_id, subject, email_accounts(is_mock)").eq("org_id", ws.org.id).eq("campaign_recipient_id", rid).eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle();
    if (!out || !(out.email_accounts as unknown as { is_mock: boolean })?.is_mock) return fail("forbidden");
    const res = await ingestInbound(ws.org.id, out.email_account_id, {
      messageId: `<sim-${Date.now()}@demo.local>`, inReplyTo: out.message_id_header, references: [out.message_id_header], from: out.to_email, fromName: null,
      to: null, subject: `Re: ${out.subject}`, text: body, receivedAt: new Date(), isAutoReply: false, isBounce: false, bouncedRecipient: null,
    });
    revalidatePath("/inbox");
    return ok({ category: "category" in res ? String(res.category) : "skipped" });
  });
}

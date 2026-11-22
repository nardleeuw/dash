import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/server/supabase/admin";
import { suppressAddress } from "@/server/compliance/unsubscribe-handler";

/**
 * Delivery events from a dedicated outbound email provider adapter.
 * Body: { events: [{ id, type, message_id, email, occurred_at }] }
 * Header: X-Leadwerk-Signature: hex(HMAC-SHA256(body, EMAIL_WEBHOOK_SECRET))
 */
const schema = z.object({
  events: z.array(z.object({
    id: z.string().min(1).max(200),
    type: z.enum(["delivered", "deferred", "bounced_hard", "bounced_soft", "complained", "unsubscribed"]),
    message_id: z.string().max(400).nullable().optional(),
    email: z.string().email().optional(),
    occurred_at: z.string().datetime().optional(),
  })).max(500),
});

export async function POST(req: NextRequest) {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 501 });
  const body = await req.text();
  const given = Buffer.from(req.headers.get("x-leadwerk-signature") ?? "", "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });

  const parsed = schema.safeParse(JSON.parse(body || "{}"));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const admin = createAdminClient();
  let processed = 0;
  for (const ev of parsed.data.events) {
    const { data: msg } = ev.message_id ? await admin.from("outbound_messages").select("id, org_id, email_account_id, to_email, campaign_recipient_id").eq("message_id_header", ev.message_id).maybeSingle() : { data: null };
    if (!msg) continue;
    const { error } = await admin.from("email_events").insert({ org_id: msg.org_id, outbound_message_id: msg.id, email_account_id: msg.email_account_id, type: ev.type, provider: "webhook", provider_event_id: ev.id, occurred_at: ev.occurred_at ?? new Date().toISOString(), payload: ev });
    if (error?.code === "23505") continue; // already processed (idempotent)
    processed++;
    if (ev.type === "delivered") await admin.from("outbound_messages").update({ status: "delivered" }).eq("id", msg.id).eq("status", "sent");
    if (ev.type === "bounced_hard") {
      await admin.from("outbound_messages").update({ status: "bounced" }).eq("id", msg.id);
      await suppressAddress(msg.org_id, ev.email ?? msg.to_email, "hard_bounce", "webhook");
    }
    if (ev.type === "complained") await suppressAddress(msg.org_id, ev.email ?? msg.to_email, "complaint", "webhook");
    if (ev.type === "unsubscribed") await suppressAddress(msg.org_id, ev.email ?? msg.to_email, "unsubscribe", "webhook");
  }
  return NextResponse.json({ processed });
}

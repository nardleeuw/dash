"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { createAdminClient } from "@/server/supabase/admin";
import { fail, ok, safeAction, type ActionResult } from "@/server/actions";
import { encryptJson } from "@/server/crypto";
import { SmtpProvider } from "@/server/sending/providers/smtp";
import { isProduction } from "@/server/env";
import { validateUrlShape } from "@/server/research/safe-fetch";
import { rateLimit } from "@/server/rate-limit";

const smtpSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().max(120).optional(),
  smtpHost: z.string().trim().min(3).max(200),
  smtpPort: z.coerce.number().int().refine((p) => [25, 465, 587, 2525].includes(p), "port"),
  imapHost: z.string().trim().max(200).optional(),
  imapPort: z.coerce.number().int().optional(),
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(500),
});

function safeHost(host: string) {
  // Mail servers must be public hosts (prevents probing internal networks).
  validateUrlShape(`https://${host}/`);
}

export async function testSmtpAction(input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    await rateLimit(`smtp-test:${ws.org.id}`, 10, 600);
    const p = smtpSchema.parse(input);
    safeHost(p.smtpHost);
    const provider = new SmtpProvider({ smtp: { host: p.smtpHost, port: p.smtpPort, secure: p.smtpPort === 465 }, imap: null, username: p.username, password: p.password });
    try {
      await provider.verify();
      return ok(null);
    } catch (err) {
      return fail(`smtp:${(err as Error).message.slice(0, 160)}`);
    }
  });
}

export async function addSmtpAccountAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    const p = smtpSchema.parse(input);
    safeHost(p.smtpHost);
    if (p.imapHost) safeHost(p.imapHost);
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("email_accounts")
      .insert({
        org_id: ws.org.id, provider: "smtp", email_address: p.email, display_name: p.displayName || null,
        smtp_host: p.smtpHost, smtp_port: p.smtpPort, smtp_secure: p.smtpPort === 465,
        imap_host: p.imapHost || null, imap_port: p.imapHost ? p.imapPort ?? 993 : null, imap_secure: true,
        username: p.username, created_by: ws.user.id,
      })
      .select("id")
      .single();
    if (error) return fail(error.code === "23505" ? "duplicate" : "unexpected");
    await admin.from("email_account_secrets").insert({ email_account_id: data.id, ciphertext: encryptJson({ password: p.password }) });
    revalidatePath("/integrations");
    return ok({ id: data.id });
  });
}

export async function addDemoAccountAction(email: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    if (isProduction()) return fail("forbidden");
    const e = z.string().trim().toLowerCase().email().parse(email);
    const admin = createAdminClient();
    const { data, error } = await admin.from("email_accounts").insert({ org_id: ws.org.id, provider: "mock", email_address: e, display_name: "Demo", is_mock: true, created_by: ws.user.id, min_delay_seconds: 10, hourly_limit: 200, daily_limit: 500 }).select("id").single();
    if (error) return fail(error.code === "23505" ? "duplicate" : "unexpected");
    revalidatePath("/integrations");
    return ok({ id: data.id });
  });
}

export async function updateAccountAction(id: unknown, input: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    const accountId = z.string().uuid().parse(id);
    const p = z.object({
      daily_limit: z.number().int().min(1).max(2000),
      hourly_limit: z.number().int().min(1).max(500),
      min_delay_seconds: z.number().int().min(10).max(3600),
      display_name: z.string().trim().max(120).nullable(),
      status: z.enum(["active", "paused"]),
    }).parse(input);
    const supabase = await createClient();
    const { error } = await supabase.from("email_accounts").update(p).eq("id", accountId).eq("org_id", ws.org.id);
    if (error) throw error;
    revalidatePath("/integrations");
    return ok(null);
  });
}

export async function removeAccountAction(id: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    const accountId = z.string().uuid().parse(id);
    const supabase = await createClient();
    const { count } = await supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("email_account_id", accountId).eq("status", "running");
    if ((count ?? 0) > 0) return fail("in_use");
    const { error } = await supabase.from("email_accounts").delete().eq("id", accountId).eq("org_id", ws.org.id);
    if (error) return fail("in_use");
    revalidatePath("/integrations");
    return ok(null);
  });
}

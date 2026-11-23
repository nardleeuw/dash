"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspace, requireRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { createAdminClient } from "@/server/supabase/admin";
import { fail, ok, safeAction, type ActionResult } from "@/server/actions";
import { encryptJson } from "@/server/crypto";
import { SmtpProvider } from "@/server/sending/providers/smtp";
import { isProduction } from "@/server/env";
import { validateUrlShape } from "@/server/research/safe-fetch";
import { rateLimit } from "@/server/rate-limit";
import { checkProviders, type HealthResult } from "@/server/providers/health";
import { mailErrorCode } from "@/server/sending/mail-errors";

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
      return fail(`mail:${mailErrorCode((err as Error).message)}`);
    }
  });
}

export async function addSmtpAccountAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    const p = smtpSchema.parse(input);
    safeHost(p.smtpHost);
    if (p.imapHost) safeHost(p.imapHost);
    // Never store a mailbox that cannot log in: the problem would only show when sending.
    try {
      await new SmtpProvider({ smtp: { host: p.smtpHost, port: p.smtpPort, secure: p.smtpPort === 465 }, imap: null, username: p.username, password: p.password }).verify();
    } catch (err) {
      return fail(`mail:${mailErrorCode((err as Error).message)}`);
    }
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

/** Replace the password of an SMTP mailbox (verified first) and resume sending right away. */
export async function updatePasswordAction(id: unknown, password: unknown): Promise<ActionResult<null>> {
  return safeAction(async () => {
    const ws = await requireRole("admin");
    const accountId = z.string().uuid().parse(id);
    const pw = z.string().min(1).max(500).parse(password);
    await rateLimit(`smtp-test:${ws.org.id}`, 10, 600);
    const admin = createAdminClient();
    const { data: acc } = await admin.from("email_accounts").select("id, provider, smtp_host, smtp_port, smtp_secure, username").eq("id", accountId).eq("org_id", ws.org.id).maybeSingle();
    if (!acc || acc.provider !== "smtp" || !acc.smtp_host || !acc.username) return fail("not_found");
    try {
      await new SmtpProvider({ smtp: { host: acc.smtp_host, port: acc.smtp_port ?? 587, secure: Boolean(acc.smtp_secure) }, imap: null, username: acc.username, password: pw }).verify();
    } catch (err) {
      return fail(`mail:${mailErrorCode((err as Error).message)}`);
    }
    await admin.from("email_account_secrets").upsert({ email_account_id: acc.id, ciphertext: encryptJson({ password: pw }), updated_at: new Date().toISOString() }, { onConflict: "email_account_id" });
    await admin.from("email_accounts").update({ status: "active", last_error: null }).eq("id", acc.id);
    // Emails that waited because the mailbox could not log in go out again from the next pass.
    const { data: runs } = await admin.from("campaigns").select("id").eq("org_id", ws.org.id).eq("email_account_id", acc.id).eq("status", "running");
    if (runs?.length) {
      await admin.from("campaign_recipients").update({ next_send_at: new Date().toISOString() }).eq("org_id", ws.org.id).in("campaign_id", runs.map((r) => r.id)).eq("status", "active").gt("next_send_at", new Date().toISOString());
    }
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

/** Platform admins: verify the platform API keys (OpenAI, Google Places, Hunter). */
export async function checkProvidersAction(): Promise<ActionResult<HealthResult[]>> {
  return safeAction(async () => {
    const ws = await getWorkspace();
    if (!ws.isPlatformAdmin) return fail("forbidden");
    await rateLimit(`provider-check:${ws.user.id}`, 10, 600);
    return ok(await checkProviders());
  });
}

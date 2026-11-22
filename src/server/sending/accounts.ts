import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson } from "@/server/crypto";
import type { MailProvider } from "./providers/types";
import { SmtpProvider, type SmtpConfig } from "./providers/smtp";
import { GmailProvider } from "./providers/gmail";
import { MicrosoftProvider } from "./providers/microsoft";
import { MockMailProvider } from "./providers/mock";
import type { OAuthTokens } from "./providers/oauth";

export type EmailAccountRow = {
  id: string; org_id: string; provider: "smtp" | "gmail" | "microsoft" | "mock"; email_address: string; display_name: string | null;
  smtp_host: string | null; smtp_port: number | null; smtp_secure: boolean | null; imap_host: string | null; imap_port: number | null; imap_secure: boolean | null;
  username: string | null; daily_limit: number; hourly_limit: number; min_delay_seconds: number; status: string; is_mock: boolean; last_sent_at: string | null;
};

/** Instantiate the provider for an account. Credentials are decrypted server-side only. */
export async function providerFor(admin: SupabaseClient, account: EmailAccountRow): Promise<MailProvider> {
  if (account.provider === "mock") return new MockMailProvider();
  const { data: secret } = await admin.from("email_account_secrets").select("ciphertext").eq("email_account_id", account.id).single();
  if (!secret) throw new Error("missing credentials");
  if (account.provider === "smtp") {
    const s = decryptJson<{ password: string }>(secret.ciphertext);
    const cfg: SmtpConfig = {
      smtp: { host: account.smtp_host!, port: account.smtp_port ?? 587, secure: account.smtp_secure ?? false },
      imap: account.imap_host ? { host: account.imap_host, port: account.imap_port ?? 993, secure: account.imap_secure ?? true } : null,
      username: account.username ?? account.email_address,
      password: s.password,
    };
    return new SmtpProvider(cfg);
  }
  const tokens = decryptJson<OAuthTokens>(secret.ciphertext);
  const persist = async (t: OAuthTokens) => {
    await admin.from("email_account_secrets").update({ ciphertext: encryptJson(t), updated_at: new Date().toISOString() }).eq("email_account_id", account.id);
  };
  return account.provider === "gmail" ? new GmailProvider(tokens, persist) : new MicrosoftProvider(tokens, persist);
}

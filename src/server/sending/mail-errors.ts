/**
 * Turns raw SMTP/IMAP errors into a code the UI explains in plain language.
 * Pure — unit tested.
 */
export type MailErrorCode = "gmail_app_password" | "outlook_basic_auth" | "login_failed" | "connection_failed" | "other";

export function mailErrorCode(raw: string | null | undefined): MailErrorCode | null {
  if (!raw) return null;
  const m = raw.toLowerCase();
  if (m.includes("5.7.9") || m.includes("application-specific password") || m.includes("invalidsecondfactor")) return "gmail_app_password";
  if (m.includes("basic authentication is disabled") || m.includes("smtpclientauthentication is disabled") || m.includes("5.7.139")) return "outlook_basic_auth";
  if (m.includes("invalid login") || m.includes("5.7.8") || m.includes("535") || m.includes("authentication failed") || m.includes("username and password not accepted") || m.includes("auth")) return "login_failed";
  if (m.includes("econnrefused") || m.includes("etimedout") || m.includes("enotfound") || m.includes("timeout") || m.includes("certificate")) return "connection_failed";
  return "other";
}

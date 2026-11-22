import "server-only";

export type OAuthTokens = { access_token: string; refresh_token: string; expires_at: number };

export const OAUTH = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly openid email",
    clientId: () => process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  },
  microsoft: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access openid email https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/User.Read",
    clientId: () => process.env.MICROSOFT_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
  },
} as const;

export type OAuthProvider = keyof typeof OAUTH;

export function oauthConfigured(p: OAuthProvider) {
  return Boolean(OAUTH[p].clientId() && OAUTH[p].clientSecret());
}

export async function exchangeCode(p: OAuthProvider, code: string, redirectUri: string): Promise<OAuthTokens & { id_token?: string }> {
  const res = await fetch(OAUTH[p].tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: OAUTH[p].clientId()!, client_secret: OAUTH[p].clientSecret()! }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; id_token?: string };
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000, id_token: j.id_token };
}

/** Return a valid access token, refreshing when needed; calls onRefresh to persist. */
export async function validAccessToken(p: OAuthProvider, tokens: OAuthTokens, onRefresh: (t: OAuthTokens) => Promise<void>): Promise<string> {
  if (tokens.expires_at - 60_000 > Date.now()) return tokens.access_token;
  const res = await fetch(OAUTH[p].tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: OAUTH[p].clientId()!, client_secret: OAUTH[p].clientSecret()! }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const next = { access_token: j.access_token, refresh_token: j.refresh_token ?? tokens.refresh_token, expires_at: Date.now() + j.expires_in * 1000 };
  await onRefresh(next);
  return next.access_token;
}

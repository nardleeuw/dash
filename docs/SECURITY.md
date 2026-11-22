# Security overview

| Area | Control |
|---|---|
| Tenant isolation | RLS on every table; membership resolved per statement; composite `(org_id, id)` foreign keys prevent cross-tenant references; covered by DB tests |
| Authorization | Role checks in every server action (`requireRole`) and again in RLS; system-managed columns guarded by triggers (compliance status, campaign status, mock flags) |
| Secrets | Server-only env vars; mailbox/OAuth credentials AES-256-GCM encrypted in tables without client grants; service-role key never shipped to the browser |
| Input validation | Zod on every action and route; strict URL/host validation |
| SSRF | Website crawler accepts public unicast IPs only (checked pre-request and at connect time), validates every redirect hop, caps size/time, respects robots.txt; SMTP hosts must be public |
| Prompt injection | Untrusted content delimited and declared as data, injection patterns detected and reported, structured outputs validated, factual claims verified against source text, no tools/secrets exposed to the model |
| Webhooks | Stripe signature verification; HMAC for email events; idempotent processing (retry-safe) |
| Unsubscribe | HMAC-signed tokens, constant-time comparison, RFC 8058 one-click |
| Rate limiting | Postgres fixed-window limiter on auth, search, research, generation, drafts, SMTP tests, location lookups, unsubscribe |
| Headers | CSP (`frame-ancestors 'none'`, `object-src 'none'`), HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP |
| Audit | Triggers log membership, subscription, permission, suppression, DSR, campaign status and email review changes; admin view in Settings → Auditlog |
| Sending safety | Hard eligibility gate at launch and at send time; one outbound row per recipient+step (unique); unknown outcomes are never re-sent; no account/domain rotation |
| Privacy | GDPR access export and erasure workflow; Google Places data expires after 30 days; KVK data not exportable |

## Known limitations / residual risks

* CSP allows `'unsafe-inline'` scripts (Next.js bootstrap). A nonce-based CSP
  via `proxy.ts` would tighten this.
* The rate limiter fails open if the database is unreachable (availability over strictness).
* OSM result cache is per server instance (in-memory, 10 minutes).
* Microsoft Graph cannot set `List-Unsubscribe`; the footer link remains.
* MFA is not enforced by the app; enable Supabase TOTP for owners.
* This software does not provide legal advice; compliance rules are product
  defaults that users must review with counsel.

# Deployment guide (Vercel + Supabase)

## 1. Supabase (EU region)

Option A — script (Management API, HTTPS only):

```bash
SUPABASE_ACCESS_TOKEN=... APP_URL=https://<your-domain> node scripts/deploy-supabase.mjs
```

It creates a project in `eu-central-1` (Frankfurt), applies every migration in
`supabase/migrations/` in order (recorded in `supabase_migrations.schema_migrations`),
sets the auth site URL and prints the env values for Vercel.

Option B — CLI:

```bash
pnpm exec supabase link --project-ref <ref>
pnpm exec supabase db push
```

Then in the Supabase dashboard:
* **Auth → Providers → Email**: keep *Confirm email* on.
* **Auth → URL configuration**: site URL = `APP_URL`, redirect `APP_URL/**`.
* **Auth → SMTP**: configure a transactional SMTP for auth emails (sign-up,
  reset). Do not use your outreach mailboxes for this.
* Consider enabling MFA (TOTP) for workspace owners.

## 2. Vercel

1. Import the GitHub repository in Vercel (framework: Next.js, region `fra1`).
2. Set environment variables (Production + Preview) from `.env.example`:
   `APP_URL`, `APP_ENV=production`, Supabase keys, `OPENAI_API_KEY`,
   `KVK_API_KEY` + `KVK_BASE=https://api.kvk.nl/api` (production key),
   `GOOGLE_MAPS_API_KEY`, `HUNTER_API_KEY`, Stripe keys, `ENCRYPTION_KEY`
   (`openssl rand -base64 32`), `UNSUBSCRIBE_SECRET`, `CRON_SECRET`, and
   optionally OAuth client ids/secrets.
3. Background jobs — choose one:
   * **Inngest (recommended)**: install the Inngest Vercel integration; it sets
     `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` and syncs `/api/inngest`.
     The cron route then skips automatically.
   * **Supabase pg_cron** (default, works on every Vercel plan): run
     `scripts/deploy-supabase.mjs` with `APP_URL` and `CRON_SECRET` set. It
     stores the secret in Supabase Vault and schedules `campaigns-tick`
     (every 5 min), `inbox-sync` (every 10 min) and `retention-purge` (daily)
     as pg_net calls to `/api/cron/*`. Use the same `CRON_SECRET` in Vercel.
     Vercel Hobby only allows daily crons, so `vercel.json` has none.
4. Deploy. `APP_ENV=production` disables every mock provider.

## 3. Stripe

1. Create a restricted or secret key; set `STRIPE_SECRET_KEY` and
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
2. As platform admin (insert your user id into `public.platform_admins`), open
   **Abonnement → Platformbeheer** and click *Synchroniseren met Stripe* to
   create products/prices for Starter/Growth/Pro.
3. Add a webhook endpoint `APP_URL/api/webhooks/stripe` for
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`; set `STRIPE_WEBHOOK_SECRET`.
4. Enable the customer portal in Stripe (cancel/upgrade/invoices).

## 4. Mail & deliverability

* Use a dedicated sending domain (e.g. `mail.youragency.nl`) with SPF, DKIM
  and DMARC; warm up gradually and keep account limits low.
* Google Workspace / Microsoft 365 OAuth: create OAuth apps with redirect URIs
  `APP_URL/api/oauth/google/callback` and `APP_URL/api/oauth/microsoft/callback`.

## 5. Go-live checklist

- [ ] `APP_ENV=production`, all keys set, mock banner gone
- [ ] KVK production key + `KVK_BASE=https://api.kvk.nl/api`
- [ ] Legal review of the compliance configuration and privacy notice
- [ ] Sender identity + privacy footer set per workspace
- [ ] Stripe webhook receiving events (test mode first)
- [ ] Inngest functions synced (or Supabase pg_cron jobs scheduled)
- [ ] Auth emails delivered via your SMTP
- [ ] Backups / PITR enabled on Supabase

## Pricing model (usage-based)

* Plan `usage` ("Op verbruik"): one-time start fee = the plan's `price_cents`
  (default €500), then a monthly invoice for actual provider cost × (1 + markup).
* Env vars (Vercel): `BILLING_MARKUP_PERCENT` (default 100),
  `BILLING_DEFAULT_CAP_CENTS` (default 25000 = €250 monthly cap),
  `STRIPE_METER_EVENT` (default `leadwerk_usage_cents`),
  `REQUIRE_PAID_PLAN=1` to switch the paywall on.
* With Stripe keys set, *Platformbeheer → Synchroniseren met Stripe* creates
  the Billing Meter and the metered €0.01 price for the usage plan. Checkout
  charges the start fee and stores the card; a daily job
  (`/api/cron/billing-usage`) reports billable cents as meter events.

# Integrations — API dependencies & setup guide

Every provider is an adapter with a **live** and a **mock** implementation.
`MOCK_PROVIDERS=auto` uses the mock when the key is missing (never in
production: there the provider is shown as *not configured*). Mock results are
labelled "Demo-data" in the UI and stored with `is_mock = true`.

| Provider | Used for | Env vars | Required? | Cost model | Status page |
|---|---|---|---|---|---|
| Supabase | DB, auth, storage | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | yes | free tier → Pro | — |
| KVK Handelsregister | Company search, basisprofiel, vestigingen, naamgevingen | `KVK_API_KEY`, `KVK_BASE` | recommended | per call (paid subscription for production) | Integraties |
| Google Places (New) | Discovery, categories, phone, website, ratings | `GOOGLE_MAPS_API_KEY` | optional | per call | Integraties |
| OpenStreetMap Overpass | Keyless discovery by tag + area | — | optional | free, fair use | Integraties |
| PDOK Locatieserver | Geocoding of NL provinces/municipalities/postcodes | — | yes (keyless) | free | — |
| Hunter.io | Domain search, email finder, verification | `HUNTER_API_KEY` | optional | credits | Integraties |
| OpenAI | Research, scoring, email writing, reply categorisation | `OPENAI_API_KEY`, `OPENAI_MODEL_*` | yes for AI | tokens | Integraties |
| PageSpeed Insights | Performance & mobile score | `GOOGLE_PAGESPEED_API_KEY` | optional | free quota | — |
| Stripe Billing | Subscriptions, extra credits | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | for paid plans | % per transaction | Abonnement |
| Inngest | Background jobs, cron | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | production | free tier | — |
| Mailboxes | Sending + reply retrieval | per account in the app (encrypted); optional OAuth apps `GOOGLE_OAUTH_*`, `MICROSOFT_OAUTH_*` | for sending | your mailbox provider | Integraties |

## KVK

* Docs: https://developers.kvk.nl/
* Header `apikey: <key>`. Test base `https://api.kvk.nl/test/api` with the
  public test key; production base `https://api.kvk.nl/api` with your own key
  (requires a KVK API subscription).
* Endpoints used: `GET /v2/zoeken`, `/v1/basisprofielen/{kvk}`,
  `/v1/basisprofielen/{kvk}/vestigingen`, `/v1/vestigingsprofielen/{nr}?geoData=true`,
  `/v1/naamgevingen/kvknummer/{kvk}`.
* Manual lookups: `./kvk.sh` (see `CLAUDE.md`).
* `indNonMailing: "Ja"` → the business opted out of unsolicited advertising;
  the compliance gate blocks sending.
* KVK data may not be resold/redistributed; Leadwerk stores it per workspace
  and marks it non-exportable.

## Google Places (New)

* Docs: https://developers.google.com/maps/documentation/places/web-service/overview
* Enable *Places API (New)* in Google Cloud, create an API key restricted to
  that API (and to server IPs where possible). Header `X-Goog-Api-Key`, field
  masks via `X-Goog-FieldMask` (we only request what we display → lower cost).
* Terms we enforce: no scraping; `place_id` may be stored indefinitely;
  coordinates max 30 days; other content is shown live and expires; attribution
  "Google Maps" shown with Places results; Places results are not drawn on a
  non-Google map.

## OpenStreetMap / Overpass

* Endpoint `https://overpass-api.de/api/interpreter`. Data © OpenStreetMap
  contributors, ODbL — attribution shown in the UI. Be gentle: small areas,
  one request at a time, cached per search.

## PDOK Locatieserver

* `https://api.pdok.nl/bzk/locatieserver/search/v3_1/{suggest,free}` — free
  Dutch government geocoder for provinces, municipalities, cities and
  postcodes (radius search centre points).

## Hunter.io

* Docs: https://hunter.io/api-documentation/
* Header `X-API-KEY`. Endpoints: `/v2/domain-search`, `/v2/email-finder`,
  `/v2/email-verifier`, `/v2/account`.
* Found addresses are stored with sources and verification status. A found
  address is **not** permission to email it — see compliance.

## OpenAI

* Structured outputs (JSON schema) through the Responses API.
* Defaults: `gpt-5.4-mini` for research/scoring/replies, `gpt-5.5` for email
  writing. All configurable.

## Stripe

1. Create products/prices for Starter (€49), Growth (€99), Pro (€199) — or run
   the in-app *Sync plans to Stripe* action as platform admin.
2. Webhook endpoint: `{APP_URL}/api/webhooks/stripe` with events
   `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
   `invoice.payment_failed`. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.

## Mailboxes

* **SMTP/IMAP**: any provider (Google Workspace with app password, Microsoft
  365, TransIP, Strato…). Credentials are encrypted with `ENCRYPTION_KEY`.
* **Gmail / Microsoft 365 OAuth** (optional): create OAuth apps and set the
  `*_OAUTH_*` variables; redirect URIs `{APP_URL}/api/oauth/google/callback`
  and `{APP_URL}/api/oauth/microsoft/callback`.
* Use a dedicated sending domain, configure SPF, DKIM and DMARC, and keep
  volumes low. The app never rotates accounts to evade limits.

## Local development

```bash
pnpm install
pnpm exec supabase start        # local Postgres/Auth/Storage (Docker)
cp .env.example .env            # fill in the values printed by supabase start
pnpm dev                        # http://localhost:3000
npx inngest-cli@latest dev      # background jobs dashboard (optional)
```

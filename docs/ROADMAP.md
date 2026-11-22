# Implementation roadmap & status

Legend: ✅ done · 🟡 partial · ⬜ not started

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | Next.js 16 app, Supabase schema + RLS, auth, onboarding, workspaces, UI shell, i18n NL/EN, docs | ✅ |
| 2 Discovery | KVK / Google Places / OSM / PDOK adapters, search filters, table + map, import, dedup, provenance, saved searches | ✅ |
| 3 Intelligence | Hunter, website crawler + signals, AI research, opportunities, lead scoring | ⬜ |
| 4 Email generation | Agency profiles, batch generation via Inngest, fact-check, review/edit/approve UI | ⬜ |
| 5 Campaigns | Mail adapters, eligibility gate, queue, schedule, rate limits, follow-ups, unsubscribe | ⬜ |
| 6 Inbox & CRM | Reply sync + matching, AI categorisation, pipeline, tasks, notes | ⬜ |
| 7 Analytics & billing | Dashboard, usage, Stripe checkout/portal/webhooks, limits | ⬜ |
| 8 Production readiness | Security review, e2e tests, deployment (Vercel + Supabase) | ⬜ |

## Phase reports

### Phase 1 — Architecture and foundation
**Implemented:** project scaffold; 6 migrations (35+ tables, enums, composite
tenant FKs, RLS for every table, guard triggers, audit triggers, RPCs for
workspace creation, invitations, member roles, credits, suppression, radius
search, recipient claiming; storage bucket); Supabase SSR auth (sign-up, login,
reset, email confirmation callbacks); proxy-based session refresh + auth gate;
workspace onboarding and switching; app shell with all 13 navigation sections;
NL/EN dictionaries; provider mode resolver (live/mock/disabled) with UI banner;
`kvk.sh` CLI.

**Tests:** 21 database tests (tenant isolation, roles, protected columns,
credits/idempotency, invitations, duplicate-send constraint) — passing.
Browser smoke test: sign-up → onboarding → overview — passing.

**Credentials status:** KVK (test key) ✅ · OpenAI ✅ · Hunter ✅ (free plan:
50 searches / 100 verifications) · Google Maps ⬜ (add as network secret) ·
Stripe ⬜ · hosted Supabase/Vercel tokens ⚠️ rejected (re-enter) · GitHub repo ⬜.

### Phase 2 — Business discovery
**Implemented:** industry taxonomy (30 industries → SBI prefixes, Google types,
OSM tags); provider adapters with live + mock implementations for KVK (search,
basisprofiel, vestigingen, vestigingsprofiel, naamgeving), Google Places (New)
text search + details with field masks, OSM Overpass (safe query builder), PDOK
Locatieserver geocoding; resilient fetch (timeouts, retries, Retry-After, cost
logging to `api_usage`); discovery orchestrator with per-provider cursors and
search credits; cross-provider result merging; import pipeline with
field-level provenance (`business_sources`, `business_attributes`), golden
record resolution by provider priority, conservative dedup (hard identifiers
never conflict-merge), PDOK geography enrichment, KVK non-mailing flag,
retention purge job (Google content 30 days, place id kept); discover UI
(filters, PDOK autocomplete, radius, sources with live/mock/test badges,
table + Leaflet map that excludes Google coordinates, selection, import into
list, saved searches); lead database (server-side filters/sort/pagination,
bulk status/list/delete); company profile (fields with provenance badges,
locations, trade names, websites, contacts, sources & retention table,
activity timeline); background job layer (Inngest functions + inline fallback).

**Tests:** 32 unit tests (normalisation, dedup scenarios incl. chains and
franchises, KVK mapping against recorded test-environment fixtures, retry on
429, Google/OSM/PDOK mapping, provider modes, golden resolution, retention
expiry) and 25 DB tests (+ import/merge/credits/retention) — all passing.
Browser run: search with live KVK test environment + PDOK + mock Google →
import 3 → lead database → profile — no console errors.

**Limitations:** KVK search cannot filter by SBI/industry (industry comes from
the basisprofiel after import); `overpass-api.de` is unreachable from this
sandbox (adapter verified with fixtures); Google Places runs in mock mode
until the Maps key is added; KVK test environment returns test companies only.

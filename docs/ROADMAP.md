# Implementation roadmap & status

Legend: ✅ done · 🟡 partial · ⬜ not started

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | Next.js 16 app, Supabase schema + RLS, auth, onboarding, workspaces, UI shell, i18n NL/EN, docs | ✅ |
| 2 Discovery | KVK / Google Places / OSM / PDOK adapters, search filters, table + map, import, dedup, provenance, saved searches | ✅ |
| 3 Intelligence | Hunter, website crawler + signals, AI research, opportunities, lead scoring | ✅ |
| 4 Email generation | Agency profiles, batch generation via Inngest, fact-check, review/edit/approve UI | ✅ |
| 5 Campaigns | Mail adapters, eligibility gate, queue, schedule, rate limits, follow-ups, unsubscribe | ✅ |
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

### Phase 3 — Business intelligence
**Implemented:** Hunter adapter (domain search, verifier; live + mock) with
contact provenance and auto-suppression of invalid addresses; SSRF-safe
fetcher (public unicast IPs only, checked pre-request and at connect time,
manual redirect re-validation, port/credential/size/time limits); polite
crawler (robots.txt, ≤5 high-value pages); HTML extraction; deterministic
signals with evidence (HTTPS, viewport, booking/ordering/chat providers,
contact/quote forms, analytics, CMS, copyright year); OpenAI structured-output
client (`store: false`, cost logging, quota errors surfaced); research prompt
with prompt-injection rules and untrusted-content delimiters; post-validation
(observations must quote crawled text verbatim, otherwise demoted to
hypotheses; opportunities verified only with surviving evidence); rule-based
opportunities phrased as "not found on the N pages analysed"; explainable
lead scoring with configurable weights + target provinces and re-scoring;
website verification (KVK number / postcode on site); research UI (queue,
stats, auto-refresh, scoring dialog), profile research tab (summary,
opportunities with evidence, verified observations, labelled hypotheses, score
breakdown, signals, pages), Hunter/verify buttons, bulk research, digital
presence filters in the lead database.

**Tests:** 48 unit (+ extraction, signals, validation, injection, scoring,
SSRF, crawler on a local site incl. robots.txt) and 28 DB (+ full research run
with a hidden prompt injection, Hunter enrichment, re-scoring) — all passing.

**Credentials:** OpenAI key is valid but the account returns
`insufficient_quota` → AI runs in labelled mock mode locally until billing is
enabled; the deterministic analysis runs regardless. Hunter free plan
(50 searches / 100 verifications).

### Phase 4 — Individual email generation
**Implemented:** sender (agency) profiles with services, ICP, USP, tone, style,
language, length, CTA, example emails, avoided phrases and signature; per-email
pipeline: ensure fresh research for THAT business (≤30 days, otherwise
research now) → choose the strongest verified opportunity matching a service →
choose the best recipient (personal/verified first, never invalid) → write
email + alternative with structured output → deterministic fact-check (every
claim must be found in the research, no invented numbers, no hypotheses as
fact, only the agency's own links, avoided phrases, deceptive subjects, spam
triggers, length) → personalisation score → compliance evaluation; batches
from selection / current filter / list with missing-only or regenerate-all,
DB-unique email per business × profile × step, idempotent credits, Inngest
fan-out with per-org concurrency (inline pool locally), progress counts,
retry failed; review table (filters, approve selected / all eligible, reject,
regenerate), editor (edit, recipient choice, alternative swap, regenerate with
instruction, fact-check + compliance + evidence panels, revision history);
hard eligibility gate (legal basis per address, generic addresses not
automatically allowed, suppression, KVK non-mailing, sender identity, privacy
notice, send-time approval/fact-check/mock checks).

**Tests:** 61 unit (+ fact-check, recipient choice, mock writer, eligibility
gate) and 31 DB (+ batch of 3 individual emails, no duplicates, revisions,
compliance becomes eligible after documenting a basis and blocks again after an
objection) — all passing. Browser: profile → import → generate → batch
progress → review → editor → approve.

### Phase 5 — Campaign management & sending
**Implemented:** AES-256-GCM secret storage; mail provider adapters (SMTP +
IMAP via nodemailer/imapflow, Gmail API, Microsoft Graph with OAuth start/
callback + signed state + token refresh, mock provider); inbound parsing with
bounce (DSN) and auto-reply detection; message composer (single recipient,
sender identity, privacy footer, signed unsubscribe link, RFC 8058 one-click
`List-Unsubscribe` + `List-Unsubscribe-Post`, threading for follow-ups);
timezone-aware sending windows, spread scheduling, per-account hourly/daily
caps and minimum gap, per-campaign daily cap; scheduler tick
(`claim_due_recipients` with SKIP LOCKED, send-time compliance gate, one
outbound row per recipient+step, unknown outcomes never auto-resent,
permanent errors → bounce + suppression, auth errors → account flagged,
retries with backoff); campaigns (draft → launch with gate → pause/resume/
cancel), recipients from approved emails/batches/lists with 90-day
recent-contact protection, follow-up sequences with AI generation and review
before sending, stop on reply/unsubscribe/objection/bounce/suppression/cancel;
unsubscribe page + one-click endpoint; signed delivery-event webhook
(idempotent); Vercel Cron fallback and local scheduler; integrations page
(provider status, SMTP/IMAP with connection test, OAuth connect, demo
account, limits); settings (organisation identity, team invitations/roles,
compliance rules, privacy footer versions, permissions with evidence upload to
private storage, suppression list, GDPR access/erasure/objection requests).

**Tests:** 72 unit (+ DST-aware windows, scheduling, composition, token
signing/tampering, encryption, inbound parsing) and 39 DB (+ full campaign:
gate on launch, send with footer/header, no duplicate step, follow-up awaits
approval, unsubscribe stops sequence, hard bounce suppression, 90-day
protection, pause/cancel) — all passing.

**Limitations:** Gmail/Microsoft OAuth not exercised live (needs OAuth apps);
Graph cannot set `List-Unsubscribe` (footer link remains). No live SMTP send
was performed (no mailbox credentials provided, by design no real emails in
tests).

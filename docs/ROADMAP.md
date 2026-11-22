# Implementation roadmap & status

Legend: ✅ done · 🟡 partial · ⬜ not started

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | Next.js 16 app, Supabase schema + RLS, auth, onboarding, workspaces, UI shell, i18n NL/EN, docs | ✅ |
| 2 Discovery | KVK / Google Places / OSM / PDOK adapters, search filters, table + map, import, dedup, provenance, saved searches | ⬜ |
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

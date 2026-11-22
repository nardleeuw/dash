# Leadwerk — notes for Claude Code

@AGENTS.md

AI-powered B2B lead generation and personalised outreach SaaS for agencies in
the Netherlands. Next.js 16 (App Router) + Supabase + Inngest + OpenAI + Stripe.
See `docs/ARCHITECTURE.md` for the full design and `docs/ROADMAP.md` for status.

## Commands

- `pnpm dev` — start the app (needs `pnpm exec supabase start` first)
- `pnpm test` — unit tests (Vitest, all providers mocked, never sends email)
- `pnpm test:db` — migration + RLS/tenant-isolation tests against local Supabase
- `pnpm typecheck` / `pnpm lint` / `pnpm build`
- `pnpm exec supabase db reset` — re-apply all migrations + seed locally

## KVK lookups (Handelsregister API)

All manual KVK lookups go through `./kvk.sh` (allowed without approval via
`.claude/settings.local.json`). It reads `KVK_API_KEY` and `KVK_BASE` from the
environment or from `.env`; `KVK_BASE` defaults to the **test** environment
`https://api.kvk.nl/test/api` (production: `https://api.kvk.nl/api`). Output is
pretty-printed with `jq` when available; the HTTP status is printed on stderr
and the script exits `2` on a non-2xx response.

```bash
# Zoeken (v2) — any API query parameter as key=value
./kvk.sh zoeken naam=test
./kvk.sh zoeken naam="test bv" plaats=Lollum type=hoofdvestiging

# Basisprofiel (v1) van een KVK-nummer, optioneel met alle vestigingen
./kvk.sh basisprofiel 68750110
./kvk.sh basisprofiel 68750110 vestigingen

# Vestigingsprofiel incl. geodata
./kvk.sh vestiging 990064773193

# Naamgevingen (handelsnamen per vestiging)
./kvk.sh naamgeving 68750110
```

Test KVK numbers: `68750110` (BV), `69599068` (Stichting), `69599076` (VoF);
test establishment: `990064773193`. Recorded responses used by the automated
tests live in `tests/fixtures/kvk/` — refresh them with the commands above.

The app itself uses the typed adapter in `src/server/providers/kvk/` (same
env vars), not this script.

Note: KVK returns `indNonMailing: "Ja"` when the business has opted out of
unsolicited advertising. The compliance gate treats this as a hard block.

## Conventions

- Code, comments and technical docs in English; UI copy in Dutch (default) and
  English via `src/i18n/`.
- Every tenant table has `org_id` + RLS. Use the user-scoped Supabase client for
  user actions; the service-role client only in jobs/webhooks, always filtering
  by `org_id` explicitly.
- Never commit secrets. `.env` is gitignored; `.env.example` documents all vars.
- Providers are adapters with a real and a mock implementation; mock mode is
  always labelled in the UI and disabled when `APP_ENV=production`.

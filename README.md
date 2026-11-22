# Leadwerk

AI-powered B2B lead generation and individually personalised email outreach for
agencies in the Netherlands (working name — see `src/config/brand.ts`).

* **Discover** Dutch businesses via KVK, Google Places and OpenStreetMap.
* **Research** every company's website individually with AI.
* **Generate** a separately researched and written email for every business.
* **Send** through a hard compliance gate (GDPR / Dutch Telecommunications Act).
* **Manage** replies, pipeline, tasks and analytics in one workspace.

## Quick start

```bash
pnpm install
pnpm exec supabase start
cp .env.example .env   # fill in values (see docs/INTEGRATIONS.md)
pnpm dev
```

## Documentation

* [Architecture & ERD](docs/ARCHITECTURE.md)
* [Integrations & setup guide](docs/INTEGRATIONS.md)
* [Roadmap & phase reports](docs/ROADMAP.md)
* [Notes for Claude Code](CLAUDE.md)

## Tests

```bash
pnpm test       # unit tests — providers mocked, never sends email
pnpm test:db    # RLS / tenant isolation against local Supabase
pnpm typecheck && pnpm lint
```

> Leadwerk helps you document a lawful basis for every message, but you remain
> responsible for your campaigns. This software is not legal advice.

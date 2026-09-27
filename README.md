# SmartManager AI Agent

An AI-powered business operating agent — give a business an AI employee that
learns the business, talks to customers, recommends products/services, takes
orders, and reports back to the owner. Built against the "SmartManager AI
Agent — Final Master Claude Code Specification" (see `ARCHITECTURE_ASSESSMENT.md`
for the audit and phase plan).

## Status

All phases in the master spec's phase list are built (`ARCHITECTURE_ASSESSMENT.md`
§98): multi-tenant schema/auth/RLS, Business Brain, the AI Gateway and
Customer Agent (deterministic-first, spec §7/§69), cart/orders, the
embeddable widget, and Phase 11's hardening pass (rate limiting, nonce
CSP, RLS/index performance tuning). See `ARCHITECTURE_ASSESSMENT.md` for
the full phase-by-phase audit.

**One known gap before this can take real money**: payments
(`src/server/payments/`) run on a mock provider only — there is no real
Stripe/PayPal/etc. integration wired in yet.

## Development

```bash
npm install
cp .env.example .env.local   # fill in the Supabase publishable key + secret key
npm run dev
```

Hosts (see `src/lib/hosts.ts`):

| Host | Area |
|---|---|
| `localhost:3000` | Platform marketing site |
| `app.localhost:3000` | Subscriber console + Super Admin (`/platform`) |
| `agent.localhost:3000` | Standalone External Agent (`/<tenant-slug>`) + embeddable widget (`/widget/<tenant-slug>`) |

`PLATFORM_ROOT_DOMAIN`/`CONSOLE_SUBDOMAIN`/`AGENT_SUBDOMAIN` in `.env.local`
control this in every environment.

## Database

Supabase project: `AI-Agent` (`irwpsewtevnzqzbsfchj`). Migrations are in
`supabase/migrations/`, applied through the Supabase MCP against the hosted
project (no local Postgres is required to develop against it, though
`npm run db:start` brings up a local stack for `npm run test:db`).

## Checks

```bash
npm run typecheck
npm run lint
npm run test        # vitest unit tests
npm run test:db     # pgTAP (requires Docker)
```

`.github/workflows/ci.yml` runs typecheck/lint/test/build on every push and
PR to `main`.

## Deployment

See `DEPLOYMENT.md` — Hostinger shared hosting, `output: "standalone"`,
manual deploy runbook.

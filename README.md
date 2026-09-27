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

Payments (`src/server/payments/`) support real gateways — Moyasar and Tap,
each connected per-tenant from the business's own console Settings page —
plus Cash on Delivery and Pay on Table for in-person payment. See
`ARCHITECTURE_ASSESSMENT.md` §22 for the one disclosed gap: this
environment's network access couldn't do a final live confirmation of
Tap's exact webhook signature algorithm — verify against a real sandbox
delivery before relying on it for live charges.

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

See `DATABASE_SETUP.md` for provisioning a Supabase project and applying
all migrations from scratch. Migrations live in `supabase/migrations/`
(no local Postgres is required to develop against a linked remote
project, though `npm run db:start` brings up a local stack for
`npm run test:db`).

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
manual deploy runbook, and the manual post-deploy configuration checklist.

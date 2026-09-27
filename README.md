# SmartManager AI Agent

An AI-powered business operating agent — give a business an AI employee that
learns the business, talks to customers, recommends products/services, takes
orders, and reports back to the owner. Built against the "SmartManager AI
Agent — Final Master Claude Code Specification" (see `ARCHITECTURE_ASSESSMENT.md`
for the audit and phase plan).

## Status

**Phase 1 — Foundation.** Multi-tenant schema (tenants, staff roles/permissions,
RLS), Supabase auth, a minimal console shell (sign in/up, "create your
business" onboarding, a per-tenant dashboard shell, a Super Admin businesses
list), i18n (en/ar/fr) and base security headers.

Not built yet, in spec order (`ARCHITECTURE_ASSESSMENT.md` §8):
Business Brain, the AI Gateway, the Customer Agent and its tools, cart/orders,
payments, the trial/subscription engine, the full Subscriber/Super Admin
dashboards, and the embeddable widget.

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

`PLATFORM_ROOT_DOMAIN`/`CONSOLE_SUBDOMAIN` in `.env.local` control this in
every environment.

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

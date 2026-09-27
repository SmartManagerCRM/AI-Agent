# SmartManager AI Agent — Architecture Assessment (Phase 0)

Status: **Approved — greenfield build.**
Date: 2026-09-27

This document is Phase 0 of the "SmartManager AI Agent — Final Master Claude Code Specification" (the attached spec). Its own §0 requires an audit and a stated implementation path before any code is written. This *is* that audit.

---

## 1. Audit findings

| Area | Finding | Consequence |
|---|---|---|
| Git repository (`SmartManagerCRM/AI-Agent`) | Empty — no commits, no code, default branch `main`. | Greenfield. Nothing to preserve or migrate. |
| Supabase project (`AI-Agent`, `irwpsewtevnzqzbsfchj`), region `ap-northeast-2`, Postgres 17 | `ACTIVE_HEALTHY`. No tables in `public`, no migrations, no custom extensions installed (only the always-on defaults: `plpgsql`, `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`). | Clean database — schema designed from migration 0001. `vector` (pgvector) is available if retrieval is ever justified (spec §71 says not to reach for it by default). |
| Sibling project `SmartManagerCRM/E-commerce` | A separate, already-substantial product (café/restaurant storefront SaaS) built by earlier sessions against an *overlapping* but narrower "AI Operating System" prompt scoped as one optional module inside that storefront. Not reused as code — this is a distinct product with its own repo and DB, per the user's explicit instruction — but its patterns (tenancy/RLS shape, provider abstraction, money-as-minor-units, JSONB i18n content, server-only service layer) are proven in production-shaped code and are reused as **conventions**, not imports. | Faster, lower-risk Phase 1 than a from-scratch design. |
| Environment variables | None configured yet. | See §7, Missing configuration. |
| Tooling in dev container | Node 22, npm 10, Docker, psql. | Supabase CLI local stack + pgTAP + Playwright are viable. |

**Conflicts found:** none (greenfield).

---

## 2. Technology decisions

| Concern | Decision | Why |
|---|---|---|
| Framework | Next.js (App Router) + React + TypeScript (strict) | Spec §4. SSR for the console/onboarding, route handlers as the server-side service layer. |
| Styling | Tailwind CSS v4, CSS-variable tokens | Fast, no per-tenant rebuild; RTL via logical properties. |
| i18n | next-intl, English / Arabic / French from day one (spec §46), RTL-aware | Matches spec's initial language set. |
| DB / Auth / Storage | Supabase (Postgres + RLS, Auth, Storage, Vault) | Spec §4 "prefer relational, MySQL-compatible architecture" — Postgres with strict typing and RLS satisfies the intent (composite FKs, generated columns, exclusion constraints) better than MySQL while staying fully relational and portable through a repository layer, matching the existing platform's Supabase organization. Repositories/services are the migration seam if a future move to another relational store is ever needed. |
| Validation | Zod at every server boundary + DB constraints | Spec §14: never trust client input, LLM-generated IDs, or tenant IDs. |
| Data access | Typed repositories (`src/server/repositories/*`) + services (`src/server/services/*`) above them | No business logic in components; the same boundary the AI tool layer calls through. |
| AI provider | Internal `AIProvider` gateway (spec §5), Google Gemini first, Anthropic as a second implementation | Vendor-agnostic from the first line of code — no file outside `src/server/ai/` ever imports a vendor SDK. |
| Model routing | `AIModelRouter` picks a fast/economical model vs. a stronger agent model per request type (spec §6), values loaded from `platform_settings`, never hard-coded | Cost control is architectural, not a later patch. |
| Payments | `PaymentProvider` abstraction (spec §17), mock/test provider for MVP | Real providers (Moyasar/Tap/Stripe) are later adapters behind the same interface. |
| Background work | `pg_cron` (available) for scheduled trial/budget checks; a secured `/api/jobs/*` worker for anything needing outbound HTTP | Consistent with the platform's existing operational pattern. |
| Tests | Vitest (unit/service), pgTAP (RLS/cross-tenant, `supabase test db`), Playwright (E2E) | Spec §84 and its own tenant-isolation requirement (§21). |

---

## 3. Multi-tenancy model (spec §21)

- Shared schema, `tenant_id uuid NOT NULL` on every tenant-owned table, RLS **enabled and forced** on all of them.
- Composite foreign keys `(tenant_id, id)` on child tables so the database rejects cross-tenant links even from privileged code.
- `app` schema (private, not exposed through the API) holds `SECURITY DEFINER`, `STABLE`, pinned-`search_path` helpers: `is_super_admin()`, `is_tenant_member(tenant_id)`, `has_tenant_role(tenant_id, roles[])`, `has_permission(tenant_id, permission)`, `tenant_has_feature(tenant_id, feature_key)`.
- Tenant identity is **always** resolved server-side (session membership for staff, resolved widget/session token for customers) — never trusted from a request body, a prompt, or an LLM tool call argument (spec §14, §21).
- A pgTAP cross-tenant isolation suite is mandatory before any other phase is considered done, exactly as the sibling project established.

---

## 4. Business-vertical abstraction (spec §47, §78)

Unlike the sibling e-commerce project (café/restaurant-only), this product's core premise is multi-vertical from Phase 1: `business_types` is a data table, not a hard-coded enum in application logic. Initial rows: `restaurant`, `cafe`, `salon`, `spa`, `gym`, `clinic`, `service_business`, `engineering`, `other`. Each vertical may later register its own tools/prompts/workflows behind the shared Agent Engine (spec §47); Phase 1 only needs the table and the tenant's reference to it to exist.

---

## 5. Database schema — Phase 1 slice

Phase 1 creates only the foundation tables the spec's own Phase 1 checklist calls for (database, tenancy, auth, roles, configuration). Business Brain, agent tools, orders, payments, trials and subscriptions are later phases (§98), each getting its own migration set:

```
extensions/private schemas   (app, ai schemas; shared updated_at trigger)
platform_settings            (spec §76 — singleton platform config)
currencies                   (spec §77)
business_types               (spec §78, data-driven)
tenants                      (spec §21, business_type FK, status, trial fields placeholder)
tenant_settings               (agent name/tone/language, JSONB, validated)
profiles                      (mirrors auth.users, full_name/phone/preferred_language)
platform_admins               (super_admin, spec §3.3)
roles / permissions / role_permissions   (business_owner, business_admin, staff — spec §22)
tenant_members                 (staff ↔ tenant, role, status)
audit_logs                    (spec §57)
```

Plans/subscriptions/trials, Business Brain, conversations, orders/cart, payments and AI usage tables are **not** created in Phase 1 — they arrive in Phases 2–7 (§98), each with its own migration and its own short assessment note, matching the phase-gate discipline the spec itself mandates (§0, §98 Phase 0).

---

## 6. Repository layout (target)

```
/
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/[locale]/...        platform marketing site
│  │  ├─ (console)/[locale]/console/...  subscriber admin panel
│  │  ├─ (platform)/[locale]/platform/   super admin
│  │  └─ api/ (webhooks, jobs, health)
│  ├─ proxy.ts                            host + locale resolution
│  ├─ i18n/                               next-intl routing/config; messages/{en,ar,fr}.json
│  ├─ server/
│  │  ├─ supabase/    (user client, service client, env)
│  │  ├─ tenant/       (resolver, context)
│  │  ├─ ai/           (provider abstraction — Phase 3)
│  │  ├─ repositories/ services/
│  │  └─ security/     (rate limiting, audit)
│  └─ lib/ (zod schemas, shared types, i18n helpers)
├─ supabase/
│  ├─ migrations/0001_… .sql
│  ├─ seed.sql
│  └─ tests/*.test.sql   pgTAP
├─ tests/ (vitest unit, playwright e2e)
└─ docs/
```

---

## 7. Missing configuration / credentials

| Item | Needed by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, publishable key | Phase 1 | Retrieved via Supabase MCP. |
| **Supabase service-role key** | Phase 1 (server) | Must be supplied as an environment secret; never committed. |
| Platform root domain | Phase 1 | For `<slug>.<root>` and the admin/platform hosts. |
| Gemini API key | Phase 3 (AI Gateway) | Spec's initial provider (§4). |
| Anthropic API key | Phase 3 (optional second provider) | For the provider-abstraction fallback path. |
| Payment provider test keys | Phase 6 | Mock provider ships first; real providers are configuration, not code changes. |

---

## 8. Implementation path

Following the spec's own phase list (§98), one phase at a time, each with a short "what got built / what didn't" note appended to this document (the same discipline `docs/ARCHITECTURE.md` used in the sibling project):

1. **Phase 1 — Foundation** (this session): schema above, auth, roles, RLS, base console shell, i18n, logging, CI scripts.
2. **Phase 2 — Business Brain**: business profile, website crawler, structured extraction, versioned knowledge storage, review/approve UI.
3. **Phase 3 — AI Gateway**: provider abstraction, Gemini + Anthropic, model router, token/cost tracking, fallback.
4. **Phase 4 — Customer Agent**: conversation engine, memory, tool registry, product/service discovery, recommendations.
5. **Phase 5 — Cart & Orders**, **Phase 6 — Payments**: deterministic backend execution behind agent tools.
6. **Phase 7 — Trial & Subscription**: 7-day / 500-conversation / hidden AI-budget trial engine, plans.
7. **Phase 8 — Subscriber Admin**, **Phase 9 — Super Admin**: full dashboards per spec §37–43, §50–57.
8. **Phase 10 — Embeddable Widget**, **Phase 11 — Hardening**.

No destructive changes are possible yet (nothing exists to destroy). Nothing in this phase blocks a later one from revising a decision here — each phase gets its own review point, per the spec's own instruction not to "blindly rewrite" but also not to over-build ahead of need.

---

## 9. Phase 2 implementation notes (Business Brain)

Two migrations, mirroring the spec's own distinction between structured
authoritative data and reviewed knowledge (§8):

- **`structured_catalog`**: `branches`, `categories`, `products` — owner-managed
  directly (RLS: `branches.read/write`, `catalog.read/write`, new permission
  keys added to the Phase 1 `permissions`/`role_permissions` tables). Prices
  are `price_minor` (bigint, minor units) so a later Cart & Orders phase never
  has to migrate money representation. Composite `(tenant_id, id)` unique
  constraints are in place so a future order-line-item table can carry a
  composite FK, matching the multi-tenancy discipline from Phase 1.
- **`business_brain`**: `business_sources` (a website URL or "manual") and
  `business_brain_entries` (about/policy/faq/promotion/instruction/
  terminology/delivery_info/pickup_info/payment_methods/contact_note/
  raw_page). `business_brain_entries` has **no insert/update/delete RLS
  policy at all** — every write goes through one of five `SECURITY DEFINER`
  functions (`create_brain_entry`, `update_brain_entry`, `approve_brain_entry`,
  `reject_brain_entry`, `set_brain_entry_active`), each re-checking
  `brain.write` itself and stamping `created_by`/`approved_by`/`approved_at`/
  `version` — none of which a client, or the crawler, is trusted to set.
- **Source priority (spec §10) is enforced structurally, not by convention**:
  `create_brain_entry`/`update_brain_entry` set `status = 'approved'`
  immediately for `source = 'admin'` (an owner's own entry, or edit of any
  entry regardless of its original source, is authoritative on the spot) and
  `status = 'pending_review'` for `source = 'website'`. A partial unique
  index allows at most one `approved` and one `pending_review` row per
  `(tenant_id, entry_key)`, so a fresh crawl can propose a change alongside
  still-active approved content without colliding — approving the new one
  supersedes the old. Versions are monotonic per `entry_key`, computed from
  the existing max, so history (`superseded`/`rejected` rows) is retained
  rather than overwritten, satisfying "compare changes" (spec §11).
- **The website crawler (`src/server/brain/`) is deterministic-only.** The
  spec's own phase order puts Business Brain (Phase 2) before the AI Gateway
  (Phase 3), so there is no LLM yet to turn crawled text into structured
  products/branches — and the spec is explicit that AI inference must never
  silently promote itself to authoritative anyway (§10). So the crawler:
  - validates the URL and runs an SSRF guard (`url-safety.ts`: rejects
    non-http(s) schemes, embedded credentials, `localhost`/`.local`/
    `.internal`, and — via a DNS lookup — any hostname that resolves to a
    loopback/private/link-local/CGNAT address) before making a single
    outbound request against an owner-supplied URL;
  - fetches `robots.txt` (`robots.ts`, a deliberately partial RFC 9309
    subset: prefix-matched Allow/Disallow for `User-agent: *` plus
    Crawl-delay) and skips disallowed paths;
  - crawls same-hostname links only, depth ≤ 1, at most 8 pages, an 8s
    per-request timeout, and a 400ms–2s inter-request delay (clamped
    `Crawl-delay` or a safe default) — bounded exactly as spec §9 asks
    ("reasonable crawl depth ... rate limits");
  - parses HTML with **cheerio** (`html.ts`), which builds a DOM and never
    executes page JavaScript — the untrusted-input requirement (spec §23)
    is structural, not a matter of remembering to sanitize;
  - extracts only what is deterministically present: `<title>`/meta
    description → an `about` entry, `LocalBusiness`/`Restaurant`/similar
    JSON-LD → a `contact_note` entry, and the page's own visible text (capped
    at 4000 characters) → a `raw_page` entry — **all as `pending_review`,
    `source = 'website'`**. It never writes to `branches`/`categories`/
    `products` itself; turning reviewed crawl findings into a structured
    product or branch is today a manual step for the owner (copy the
    reviewed fact into the Products/Branches pages). Automatic
    crawl-to-structured-draft extraction is deferred until the AI Gateway
    (Phase 3) can do that reasoning reliably.
  - runs synchronously inside the "Add website" Server Action today (no job
    queue exists yet) — fine at 8 pages/8s-timeout scale, but a real
    background worker (the spec's own `/api/jobs/*` pattern, already used
    elsewhere in this codebase's sibling project) is the natural next step
    once crawls need to be bigger or retried.
- **Console**: a "Business Brain" page (add/recrawl/disable a website source,
  a manual-entry form, and an approve/reject/archive list of entries) plus
  new "Products / Services" and "Branches" pages (spec §74's subscriber nav).
  "Agent", "Conversations" and "Settings" got placeholder pages so the nav
  doesn't lead to a bare 404 before their own phases land.
- **Tests**: `tests/unit/brain-robots.test.ts`, `brain-html.test.ts`,
  `brain-url-safety.test.ts` (19 assertions, no network — the SSRF guard's
  literal-IP path is exercised directly; a live DNS-resolution case is not,
  since this sandboxed environment's outbound network goes through an agent
  proxy the crawler's own `fetch` does not use). `supabase/tests/
  002_business_brain.test.sql` adds structural pgTAP checks (RLS
  enabled+forced, zero direct write policies on `business_brain_entries`,
  all five write functions present).
- **What Phase 2 does not include**: turning crawled facts into structured
  product/branch drafts automatically (needs the AI Gateway), a "compare
  versions" diff view in the UI (the data model supports it — `entry_key` +
  `version` — the UI only lists current-status rows today), asynchronous/
  queued crawling, and multi-page crawls beyond depth 1 (sufficient for a
  typical single-site menu/about/contact page onboarding, not a full site
  map).

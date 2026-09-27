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

---

## 10. Phase 3 implementation notes (AI Gateway)

Two migrations: `ai_gateway` (`ai_model_configs`, `agent_interactions`,
`record_agent_interaction`, `agent_interaction_stats`) and `ai_model_seed`
(today's list prices).

- **Deterministic-first is a first-class requirement, not an optimization
  applied later** (spec §7, §69, and the platform owner's own explicit
  instruction): `src/server/ai/gateway.ts` is the single entry point every
  future customer-facing surface (Phase 4's Customer Agent, Phase 10's
  widget) will call, and it tries `src/server/ai/deterministic/match.ts`
  — pure, no I/O, unit-tested — *before* it ever reaches for a model.
  Matchers answer from real Phase 1/2 data (`src/server/ai/deterministic/
  snapshot.ts` builds the snapshot from `products`, the default `branches`
  row, and approved+active `business_brain_entries`): greetings/thanks,
  today's opening hours, delivery/pickup/payment notes, a product's price,
  and simple keyword-matched FAQs. Anything else falls through to AI. **Every
  interaction is recorded either way** — `record_agent_interaction` is
  called on both the deterministic path and the AI path — so
  `agent_interaction_stats(tenant_id)` gives a real, queryable
  "% of interactions handled without AI" per tenant, not an estimate. The
  Agent console page surfaces this number today (see below); a platform-wide
  rollup is natural Super Admin (Phase 9) material once there is real
  traffic to roll up.
- **Provider abstraction** (`src/server/ai/provider.ts`): a vendor-agnostic
  `AIProvider` (`configured()`, `chat()`), content-block based
  (text/tool_use/tool_result) so adding the tool-calling loop in Phase 4 is
  not a breaking change to this shape. `gemini.ts` calls the Generative
  Language REST API directly (`fetch`, no SDK — there is no first-party
  Node SDK convention already established in this codebase for Gemini).
  `anthropic.ts` uses the official `@anthropic-ai/sdk` — unlike Gemini, a
  first-party TypeScript SDK exists, so this file uses it rather than raw
  HTTP, per that SDK's own guidance. Thinking is explicitly disabled on the
  Anthropic path today: this phase's traffic is short deterministic-fallback
  replies, not open-ended agentic reasoning, and Sonnet 5 runs adaptive
  thinking by default otherwise — Phase 4's real tool-calling loop should
  revisit that (low/medium effort rather than disabled, once tools are
  actually in play, per the model's own documented failure modes for
  disabled thinking with tools).
- **Gemini is the paid, primary provider — set at deploy time.** Per the
  platform owner's explicit instruction, this is not built around a
  free-tier assumption: `ai_model_seed` marks both Gemini rows
  `is_default = true` with current *paid* list pricing, and
  `GEMINI_API_KEY` is documented in `.env.example` as an env var added on
  Hostinger at deploy time. Anthropic is seeded active (so the router's
  fallback chain has somewhere to go if a Gemini call fails) but not
  default; its two rows use verified current Anthropic list pricing
  (Claude Haiku 4.5 / Claude Sonnet 5). All four rows carry a `notes` column
  flagging them as today's published prices, to be confirmed by Super Admin
  (Phase 9 UI) before being relied on for real budget alerts — spec §6's
  "do not assume permanent... prices" is a data-editability guarantee, not
  a promise that day-one seed values are eternally correct.
- **Model routing** (`src/server/ai/router.ts`): `orderModelConfigs` (pure,
  unit-tested) puts the `is_default` row first among active rows of the
  requested `kind` (`fast`/`agent` — spec §6's Flash-Lite/Flash split);
  `pickConfiguredModel`/`fallbackChain` additionally filter to providers
  that actually have credentials, so a Gemini-only deployment (today's
  default) never even tries to call Anthropic. `gateway.ts`'s AI path walks
  the whole fallback chain on failure (spec §68), marking `fallback_used`
  when a non-first candidate served the request, and records a `success:
  false` row (never silently swallowed) when every candidate fails or none
  is configured.
- **Cost accounting** (`src/server/ai/pricing.ts`, pure, unit-tested):
  `calculateCostUsd` multiplies actual token usage by whatever
  `ai_model_configs` currently says — a price change is a data edit. Costs
  are stored as `numeric(12,6)` USD (not "minor units"): the spec's own
  $0.50 trial ceiling (a later phase) needs sub-cent precision this format
  gives directly.
- **Console**: the Agent page (previously a placeholder) now has a real
  settings form (active/name/greeting/tone — writes `tenant_settings.agent`,
  already schema'd since Phase 1) and a clearly labeled test panel (spec
  §73 "clearly marked test environment... do not accidentally create real
  orders" — trivially true today, since no cart/order exists yet) that runs
  a message through the real gateway and shows whether it was handled
  deterministically (which rule) or by AI (which provider/model/cost),
  plus a 30-day stats block (interactions, % handled without AI, AI cost)
  from `agent_interaction_stats`.
- **No live provider key in this environment** (the same constraint the
  sibling project's own AI phases documented): the gateway, router, pricing
  and deterministic-matcher logic are unit-tested without network; the
  Gemini/Anthropic HTTP calls themselves are not exercised end-to-end here,
  since neither `GEMINI_API_KEY` nor `ANTHROPIC_API_KEY` is set in this
  sandbox. That happens once the platform owner adds a paid `GEMINI_API_KEY`
  on Hostinger.
- **What Phase 3 does not include** (later phases, per spec §98): the
  tool-calling loop and tool registry, conversation memory/context
  management, the Customer Agent's product discovery and recommendations
  (Phase 4); a Super Admin UI for `ai_model_configs` (Phase 9 — the table
  and its RLS gate already exist); platform-wide (cross-tenant) AI economics
  rollups; and per-conversation token/step limits (spec §24, §31 — there is
  no multi-turn conversation yet for a limit to apply to).

---

## 11. Addendum — Multi-Source Business Brain & Standalone Agent

A separate addendum document arrived after Phase 3 shipped, with one
"CRITICAL ARCHITECTURE ADDENDUM" line: **the AI Agent must not depend on a
website.** Phase 2, as built, modeled Business Brain sources as
`kind in ('website', 'manual')` — correct for what existed, but the wrong
shape for where the addendum says this is going (Instagram, Facebook, PDF
menus, images, Google Business, API integrations — each just one more
`source_type`, never a reason to touch the Business Brain schema itself).
This section is the retrofit — schema and code changes to already-shipped
Phase 2/3 work — done *before* starting Phase 4, per the addendum's own
framing and the instruction that came with it.

**Migration `multi_source_business_brain`** (all tables were empty — 0 rows
— so every rename below is a pure schema change, no data migration):

- `business_sources.kind` → `source_type`, widened to the addendum's full
  vocabulary (`website, instagram, facebook, online_menu, pdf, document,
  image, google_business, manual, api`) — only `website` and `manual` have
  a real connector today; the rest exist so adding one is additive (spec
  addendum §2: "allow new source connectors without redesigning the
  Business Brain"). `last_crawled_at` → `last_scanned_at`, `pages_crawled`
  → `items_processed` (a PDF page count and an Instagram post count are
  both "items processed", not "pages crawled"). New columns matching the
  addendum's own field list (§2): `scan_frequency` (manual/daily/weekly),
  `content_hash` (change detection for a future scheduled-refresh job —
  not wired up yet, spec §23), `extraction_status` (`raw_only` today for
  every connector — no connector produces structured drafts yet, since that
  needs AI reasoning; `partial`/`structured` are there for when one does).
- `business_brain_entries.source` → `source_type` (same vocabulary), plus
  `confidence` (`high`/`medium`/`low`), `source_url`, `last_verified_at` —
  the addendum's §24 traceability requirement ("every important fact
  should retain its source... confidence... last verified").
- **New table `business_brain_conflicts`** (addendum §6: "Detect and
  record conflicts. Never silently choose an arbitrary value.") — an
  array of `{source_type, source_id, value, confidence, detected_at}` per
  disagreement, `status` open/resolved, resolved by
  `resolve_brain_conflict()` (SECURITY DEFINER, same pattern as every other
  Business Brain write). **Conflict detection lives inside
  `create_brain_entry` itself**, not a separate batch job: proposing a new
  value for a key that already has an `approved` value from a *different*
  source, with genuinely different content, both records the conflict and
  (for a non-`manual` proposal) leaves the existing approved fact live
  while the new one waits in `pending_review` — the two coexist by design
  (same partial-unique-index mechanism Phase 2 already had). This also
  fixed a latent bug the addendum's own conflict scenario exposed: a
  `manual` entry reusing an already-`approved` key would previously have
  hit the `(tenant_id, entry_key) where status = 'approved'` unique index
  and errored; `create_brain_entry` now supersedes the old approved row
  first when the new source is `manual` (an owner's entry always wins
  immediately, per source priority), so the override succeeds instead of
  crashing.
- **Confidence defaults by source** (addendum §8: "treat social content as
  lower-confidence than owner-confirmed data"): `manual` → `high`;
  `instagram`/`facebook`/`image` → `low`; everything else (`website`,
  `online_menu`, `pdf`, `document`, `google_business`, `api`) → `medium`.
  `admin` was renamed to `manual` throughout (the entries table's source
  vocabulary now matches the sources table's exactly) — an owner typing
  something into the console *is* the `MANUAL_INPUT` source type, not a
  separate concept needing its own word.
- **`tenants.deployment_mode`** (`website_widget` | `external_agent` |
  `both`), default **`external_agent`** — not an opt-in. The addendum's
  critical rule is that a subscriber needs no website at all; defaulting
  new tenants to the mode that doesn't require one makes that the actual
  behavior, not just a claim in this document. Phase 10 (Embeddable
  Widget) is now understood to *also* cover the addendum's External Agent
  page and QR code (§14–§18) — the same Agent Engine and Business Brain
  behind both `website_widget` and `external_agent`, never a duplicated
  agent per channel (addendum §20).
- **Console**: the Business Brain page now shows an open-conflicts section
  (pick which source's value is correct, per key) above the sources list,
  and each knowledge entry shows its confidence alongside its source.
- **What is *not* built yet** (this was a schema/architecture retrofit,
  not new connectors): the Instagram, Facebook, PDF, document, image-OCR,
  Google Business and API connectors themselves — each is real,
  scoped work for whichever future phase needs it, now additive rather
  than a redesign. Scheduled/automatic rescans (`scan_frequency` is stored
  but nothing reads it yet), and the External Agent's own page/URL/QR code
  (Phase 10, now scoped by this addendum rather than newly invented).

---

## 12. Phase 4 implementation notes (Customer Agent)

The addendum moved the External Agent forward: it is the first real
customer-facing surface, built now rather than deferred to Phase 10,
because the addendum's own critical rule ("the Agent must function with
NO WEBSITE") makes it the natural way to exercise the Customer Agent at
all — a website widget would have meant building the one thing the
addendum says not to depend on.

- **New host: `agent.<root>/<tenant-slug>`** (`src/lib/hosts.ts`,
  `AGENT_SUBDOMAIN` env var, default `agent`). Deliberately **no locale in
  the URL** — addendum §17 wants a clean, shareable link (Instagram bio,
  QR code, receipts), so the proxy negotiates locale silently
  (cookie/Accept-Language) instead of redirecting to inject one, unlike
  the platform/console hosts.
- **`tenants.deployment_mode`** (added by the addendum retrofit, §11
  above) gates the page: only `active` tenants with `external_agent` or
  `both` resolve; anything else 404s. `resolvePublicTenant()`
  (`src/server/agent-public/tenant.ts`) is the one place that check lives.
- **No customer account system exists, so identity is a hashed cookie,
  not a login** — the same pattern this product's sibling project uses
  for guest carts/bookings. `src/server/agent-public/session.ts` generates
  a random token, stores only its SHA-256 hash on the `conversations` row,
  and sets it HttpOnly. Because there is no Supabase Auth user at all on
  this path, `conversations`/`conversation_messages` (migration
  `conversations`) have **no RLS write policy and no SECURITY DEFINER
  function** — the only way to reach them is the service-role client,
  used exclusively inside `src/server/agent-public/actions.ts`, a trusted
  Server Action that resolves and validates the tenant itself before
  touching anything. Staff get read-only access via the ordinary
  `agent.read` permission (the new Conversations console page).
- **The AI Gateway (Phase 3) needed one real change to serve a multi-turn
  conversation**: it previously sent the model a single message with no
  business context and no history. `runAgentGateway` now accepts an
  optional `history: AITurnMessage[]` (the caller's job to load — the
  gateway still knows nothing about the `conversations` table, so the same
  gateway serves a stored conversation and a stateless console test
  message identically), and the AI fallback path's system prompt is built
  by the new, unit-tested `buildSystemPrompt()` (`src/server/ai/
  system-prompt.ts`) from the same `BrainSnapshot` the deterministic
  matchers already use — the business's own products (capped at 40, spec
  §19: never the entire catalog), branch, and delivery/pickup/payment/
  about notes — so "something spicy and cheap" (spec §7's own example of
  a query deterministic matching can't handle) reaches the model with
  real product names and prices to recommend from, and an explicit
  instruction that no order/payment exists yet to falsely confirm.
- **A best-effort in-process rate limit** (20 messages/minute per
  conversation) on the one public entry point — spec §65 for "public
  widget" traffic; a real multi-instance deployment would need a shared
  store, noted in the code rather than silently assumed away.
- **Console**: the Agent page now shows the tenant's public Agent URL
  (when `deployment_mode` allows it) right next to the settings/test panel
  it already had; the Conversations page (previously a placeholder) lists
  real conversations and their most recent message.
- **What Phase 4 does not include**: a formal tool-calling loop and tool
  registry (spec §92) — the AI path today is a single-turn-per-message
  chat grounded in a system-prompt snapshot, not yet able to call
  `add_to_cart`/`create_booking`-style tools, because Cart & Orders
  (Phase 5) doesn't exist yet for a tool to act on; conversation
  summarization for very long histories (spec §18 — today it just sends
  the last 12 messages); and the External Agent's branded logo/offers/
  locations sections and QR code (addendum §16–§18 — the page shows name,
  about text and featured products today, the rest follows once Branches/
  Business Brain have more to show and Phase 10's polish pass lands).

---

## 13. Phase 5 implementation notes (Cart & Orders)

This phase is where the Customer Agent stopped being chat-only: Phase 4
deferred the tool-calling loop for lack of anything to act on, so the
first thing this phase builds is that loop itself, then the cart/order
schema it acts on.

- **Schema** (migration `cart_and_orders`): `carts`/`cart_items` (one
  active cart per conversation — the same hashed-cookie session that
  identifies a conversation identifies its cart, no separate customer
  account needed), `orders`/`order_items`/`order_status_history`
  (spec §16's exact 9 statuses: draft/pending_payment/paid/confirmed/
  preparing/ready/completed/cancelled/refunded), `tenant_counters` for
  human-friendly per-tenant order numbers. Same access pattern as
  `conversations`: **no RLS write policy anywhere** — every write is
  either the service-role client (customer path, via the cart/order
  service in `src/server/commerce/`) or one of two SQL functions.
- **`create_order_from_cart` is the one place a total is ever computed**
  (spec §15) — it re-reads every product's live price, applies the
  tenant's own delivery fee/tax settings, and only then writes the order.
  Nothing upstream (the AI, the cart, the customer) ever supplies a total.
  Seeding `tenant_counters` at tenant creation (a small `create_business`
  change) closes a first-order race two concurrent orders could otherwise
  hit. `update_order_status` is a second function enforcing spec §16's
  transition table — a `confirmed` order can become `preparing` or
  `cancelled`, never anything else, staff-only (`orders.write`).
- **The tool-calling loop now exists** (`src/server/ai/gateway.ts`
  rewritten, `src/server/ai/tools/registry.ts` + `tools/handlers.ts`):
  11 tools (search/get_product, view/add/update/remove/clear cart,
  set_fulfillment, set_customer_details, place_order,
  request_human_handoff), capped at `MAX_AGENT_STEPS = 8` (spec §24) per
  user message. Every handler is a thin wrapper over the cart/order
  service — the model can never do anything a customer couldn't already
  do by hand, and `place_order` calls the same `create_order_from_cart`
  regardless of who's asking.
- **Tools are addressed by product *name*, not id** — a deliberate scope
  decision, not an oversight: tool_use/tool_result blocks live only
  within one gateway call and are never persisted (only plain message
  text is, in `conversation_messages`), so an id `search_products` handed
  out in an earlier customer message wouldn't survive to a later one.
  Name matching against the live catalog does. `matchProductByName`
  (`src/server/commerce/cart.ts`) is pure and unit-tested; a future phase
  that persists per-turn tool history could move to ids.
- **Tools are only enabled when a real `conversationId` is supplied** —
  the console's Agent preview (Phase 3/4) deliberately omits it, so a
  staff test message still gets a text-only reply and can never create a
  real cart or order, honoring spec §73's "do not accidentally create
  real orders" for the one surface meant to be a safe sandbox.
- **Console**: an Orders page (list, per-status next-action buttons calling
  `update_order_status`) and a Settings → "Ordering & checkout" section
  (ordering on/off, pickup/delivery, delivery fee, minimum order, tax) —
  without the latter, `tenant_settings.checkout.ordering_enabled` has no
  UI path to ever become `true`, so it shipped in the same phase as the
  tools it gates.
- **Tests**: `tests/unit/commerce-cart.test.ts` (pure name-matching logic,
  no network) plus the existing gateway/router/pricing suites still pass
  unchanged since the tool loop is additive to the same `runAgentGateway`
  signature. `supabase/tests/006_cart_and_orders.test.sql` adds structural
  pgTAP checks (RLS, zero direct write policies, order-number uniqueness).
- **What Phase 5 does not include**: payment — every order is created
  `pending_payment` and stays there until staff manually mark it `paid`
  (Phase 6 adds the `PaymentProvider` abstraction and a real/mock
  provider); delivery zones with distance-based fees (today's delivery
  fee is one flat tenant-wide amount); stock/inventory checks on
  add-to-cart (products have no inventory concept yet in this schema);
  and persisting tool-call history per turn (noted above — the reason
  tools use product names today).

## 14. Multimodal-ready communication layer

Before Phase 6, per instruction: design the Agent communication layer so
Voice can be added later without touching Business Brain, tools, cart,
orders, payments, or fulfillment — while shipping only Text for the MVP.

- **The boundary already existed by construction**: `runAgentGateway`
  (`src/server/ai/gateway.ts`) has always taken a plain `string` message
  and returned a plain `string` reply; the deterministic matcher pipeline,
  the tool registry, and every commerce module operate purely on
  structured data (product names, cart/order rows) and never see how a
  message arrived or how a reply will be delivered. This section makes
  that boundary an explicit, documented contract instead of an implicit
  property of the code, and gives it exactly one piece of schema so the
  claim is checkable rather than aspirational.
- **`src/server/ai/channel.ts`** (new): defines `AgentModality = "text" |
  "voice"` and the `AGENT_MODALITY_TEXT` constant, with the doc comment
  spelling out the intended shape of a future voice channel as a pure
  I/O adapter — `voice in → speech-to-text → runAgentGateway(text) →
  reply (text) → text-to-speech → voice out` — that wraps the existing
  gateway rather than changing it. `runAgentGateway`'s signature is
  untouched by this phase; nothing in `gateway.ts`, `tools/`, `commerce/`,
  or the payments layer changes.
- **Schema** (migration `message_modality`): `conversation_messages`
  gains one column, `modality text not null default 'text' check
  (modality in ('text', 'voice'))`. It is delivery metadata recorded
  alongside a message — never read by the gateway, the matcher, a tool,
  or any commerce module — so a future voice adapter writes `'voice'`
  for messages it produces without any of those layers needing to know
  the column exists. `src/server/agent-public/actions.ts`, the only
  place that inserts into this table, now stamps both the customer's
  message and the assistant's reply with `AGENT_MODALITY_TEXT`.
- **Tests**: `supabase/tests/007_channel_agnostic.test.sql` pins the
  column, its `'text'` default, and the check constraint (verified live
  against the project via direct SQL, since pgTAP itself isn't installed
  on the remote database — consistent with how the prior structural test
  files in this repo are exercised).
- **What this section does not include, deliberately**: no speech-to-text
  or text-to-speech integration, no audio storage or streaming, no voice
  UI in the console or the External Agent page, and no changes to
  `AITurnMessage`/`ChatInput`/`ChatResult` in `src/server/ai/provider.ts`.
  Those all remain future work for whenever a voice channel is actually
  built; today's change is scoped to proving the boundary holds and
  reserving the one column a future adapter will need.

## 15. Phase 6 implementation notes (Payments)

The one rule this phase exists to enforce (spec §17, §63, §64): an order
only ever becomes `paid` through **server-side verification of a
provider's own notification** — never from anything the frontend, the
customer, or the LLM claims. Everything below is built to make that rule
structurally true, not just documented.

- **`PaymentProvider` abstraction** (`src/server/payments/provider.ts`),
  mirroring `AIProvider` (spec §5's pattern applied to payments): nothing
  outside `src/server/payments/` calls a vendor SDK or verifies a webhook
  signature directly. `createIntent` starts an attempt with the provider;
  `verifyWebhook` authenticates a delivery and returns `null` — never a
  best-guess payload — when the signature doesn't check out.
- **The mock provider** (`src/server/payments/mock.ts`) is the one
  implementation wired in for the MVP. There is no real gateway behind
  it, but it still exercises the real mechanism: it HMAC-signs its own
  webhook payloads and verifies them with `timingSafeEqual`, the same as
  a real provider's SDK would. Its signing secret lives in code, not an
  env var — unlike `GEMINI_API_KEY`/`ANTHROPIC_API_KEY`, there is no
  external vendor to inject a deploy-time credential for, since the mock
  provider *is* our own code. A real provider (Stripe/PayPal) is a second
  `PaymentProvider` implementation added later, wired in from
  `src/server/payments/service.ts`'s one `paymentProvider` export —
  nothing else in this phase changes.
- **Schema** (migrations `payments`, `phase6_hardening`, `payments_fix`):
  `payments` (one row per attempt; `provider_intent_id`, `status`
  pending/succeeded/failed, the amount/currency the order itself already
  computed) and `payment_webhook_events` (a dedupe ledger — a provider
  may retry the same event, and the unique `(provider, event_id)`
  constraint is what makes a duplicate delivery a no-op instead of a
  double-charge or a duplicate order-status transition). A unique partial
  index (`payments_order_active_uidx`, `where status in ('pending',
  'succeeded')`) is the actual idempotency guarantee behind "resume, don't
  duplicate, a payment attempt" — enforced by Postgres, not trusted to
  application logic. `payments_fix` corrects a `char(3)` vs `text` type
  mismatch in `create_payment_attempt`'s `RETURNS TABLE` that a live
  functional test caught before this migration was ever committed (see
  that migration's own comment).
- **Four SECURITY DEFINER functions, and no others, ever touch this
  data**: `create_payment_attempt` (re-reads the order's own total —
  never trusts a caller-supplied amount, the same discipline
  `create_order_from_cart` already applies) and `record_payment_provider_intent`
  are reachable from trusted server code (staff console or the
  service-role customer path); `mark_payment_succeeded` and
  `mark_payment_failed` are **service-role only** — reachable only from
  `processProviderWebhook` (`src/server/payments/webhook.ts`), which has
  already verified a signature before calling either. Confirmed against
  the live project: `create_payment_attempt` reused an existing pending
  attempt rather than duplicating it, a duplicate webhook event
  no-opped instead of erroring, a successful payment flipped both
  `payments.status` and `orders.status` in the same function, and a
  failed payment left the order `pending_payment` so `create_payment_attempt`
  starts a genuinely new attempt on retry.
- **The webhook route** (`src/app/api/payments/webhook/[provider]/route.ts`)
  lives under `/api/`, so `src/proxy.ts`'s host-based rewriting never
  touches it — a provider needs one stable path regardless of which host
  serves the app. It reads the raw body, resolves the provider's own
  signature header (`PaymentProvider.webhookSignatureHeader`), and calls
  `processProviderWebhook`, which re-reads the matching `payments` row and
  cross-checks the webhook's amount/currency against what was recorded
  when the intent was created before ever calling `mark_payment_succeeded`
  /`mark_payment_failed` — defense in depth against a provider integration
  bug, not just its signature.
- **The mock checkout page** (`src/app/agent/pay/[paymentId]/page.tsx`,
  reachable at `agent.<root>/pay/<paymentId>` — same host as the External
  Agent, addendum-style clean link) is explicitly labeled a test page. Its
  two buttons never mark the payment directly: `simulateMockPaymentAction`
  (`src/server/payments/actions.ts`) has the mock provider sign a webhook
  payload and hands it to the exact same `processProviderWebhook` a real
  provider's own server-to-server call would go through — the honest way
  to keep "only server-verified" true even when the provider is fake.
- **Agent integration**: `place_order` (`src/server/ai/tools/handlers.ts`)
  now calls `initiatePayment` right after the order is created and
  includes the checkout URL in its tool result text; the chat panel
  (`src/components/agent-public/chat-panel.tsx`) linkifies bare URLs in
  assistant messages so the link is clickable. A new `check_order_status`
  tool (wrapping `getOrderStatusByNumber`, unused since Phase 5) lets a
  customer ask whether their order has been paid without the model ever
  answering from memory — `system-prompt.ts`'s stale Phase 4 line ("there
  is no ordering system connected") was corrected to "only confirm an
  order or payment... when a tool result says so," which is what actually
  holds now that Phase 5's tools exist.
- **Console**: the Orders page gets a read-only Payment column (latest
  attempt's status per order) — staff marking an order `paid` manually
  (cash/COD, via the existing `update_order_status`) is a distinct, still
  legitimate human-verified path this phase does not touch or gate.
- **Tests**: `tests/unit/payments-mock.test.ts` (signature acceptance,
  tampered-body/wrong-signature/wrong-length/malformed-JSON/unknown-status
  rejection, all pure, no network); `supabase/tests/008_payments.test.sql`
  adds structural pgTAP checks (RLS, zero direct write policies, the four
  functions exist, the active-attempt unique index, webhook-event
  uniqueness) — verified directly against the live project's schema, same
  as Section 14's, since pgTAP itself isn't installed there.
- **What Phase 6 does not include**: a real payment gateway (Stripe/PayPal
  — this phase's whole point is that adding one later is a second
  `PaymentProvider` implementation, not a redesign); refunds (`orders.status`
  already has a `refunded` state from Phase 5, but nothing computes or
  records a refund amount yet); partial payments or multiple payment
  methods per order; and a provider-choice setting per tenant (there is
  one provider for the whole platform today, the same posture as the AI
  providers in `env-core.ts`).

## 16. Phase 7 implementation notes (Trial & Subscription)

- **A real gap this phase closes**: nothing before it ever moved a tenant
  out of `tenants.status = 'onboarding'`. `resolvePublicTenant`'s
  `status = 'active'` check — the External Agent's own gate, in place
  since Phase 4 — was consequently unreachable for any tenant created so
  far. `create_business` (extended a third time now, after Phase 1 and
  Phase 5) fixes this as a side effect of starting the trial: every new
  business is created directly `active`, on an automatic free trial, no
  card required.
- **Entitlement is computed live, never cached**: `tenants.status` stays a
  purely administrative state (Super Admin suspending/closing a business);
  whether a tenant is *currently* allowed to use the Agent is a separate
  question, answered fresh every time by `src/server/billing/entitlement.ts`'s
  pure `isEntitled(subscription, now)` against `subscriptions.status`/
  `trial_ends_at`/`current_period_end` — the same "never trust stale
  state, re-verify" discipline `create_order_from_cart` already applies to
  prices. There is deliberately no scheduled job that flips a tenant to
  `suspended` when a trial lapses; expiry is enforced the instant anyone
  asks, which is simpler and cannot drift out of sync with a cron that
  didn't run.
- **One choke point enforces it for every AI/tool cost**: `runAgentGateway`
  (`src/server/ai/gateway.ts`) checks entitlement — via a service-role
  read, deliberately ignoring whichever client the caller passed in, so a
  staff member without `billing.read` can never make an actually-entitled
  tenant look unentitled — before it does anything else, for both the
  External Agent and the console's Agent preview. A lapsed trial is
  recorded as a zero-cost `deterministic`/`trial_expired` interaction, not
  a wasted AI call. `resolvePublicTenant` (`src/server/agent-public/tenant.ts`)
  also checks it, so the External Agent page itself 404s cleanly instead
  of rendering a chat UI that would then refuse every message.
- **Schema** (migrations `subscriptions`, `phase7_hardening`):
  `subscription_plans` (a data-driven catalog, not a hard-coded enum — same
  posture as `business_types`/`ai_model_configs` — seeded with `starter`
  and `pro`, each with its own `trial_days`; `limits jsonb` is reserved for
  future enforcement, e.g. a monthly interaction cap, nothing reads it
  yet), `subscriptions` (one row per tenant, a singleton like
  `tenant_settings`), and `subscription_payments`. The last is
  deliberately **not** shaped like `payments` (Phase 6): an order is paid
  once, so a `succeeded` row blocks any further attempt forever; a
  subscription is paid again every period, so only a *pending* attempt is
  exclusive (`subscription_payments_tenant_pending_uidx`) — a past success
  must never block the next period's payment. Confirmed live: a second
  `create_subscription_payment_attempt` after a first success created a
  genuinely new row rather than being rejected or silently reused.
- **Four SECURITY DEFINER functions, mirroring Phase 6's shape exactly**:
  `create_subscription_payment_attempt` (owner-only — `billing.write` — 
  there is no anonymous/customer path here, unlike order payments) and
  `record_subscription_payment_provider_intent` are reachable from trusted
  server code; `mark_subscription_payment_succeeded`/`_failed` are
  **service-role only**, reachable solely from the webhook path. A
  successful payment sets `subscriptions.status = 'active'`, extends
  `current_period_end` by the plan's own `billing_interval`, and — the
  same "restore, don't just unblock" touch as Phase 6's failed-order
  handling — reactivates a tenant a Super Admin never touched but that had
  lapsed into `suspended` purely for non-payment. A failed attempt never
  revokes whatever entitlement (trial or a prior paid period) the tenant
  already had. Confirmed live against the project, including the exact
  `create_business` → trial → expire → pay → `active` lifecycle.
- **One webhook route serves both domains**: `/api/payments/webhook/[provider]`
  (Phase 6) now tries `processProviderWebhook` (orders) first and only
  falls through to `processSubscriptionProviderWebhook`
  (`src/server/billing/webhook.ts`, new) on a `NOT_FOUND` — never on a
  real error (an invalid signature or a mismatch is definitive regardless
  of domain) — the same way a real provider integration dispatches one
  endpoint across every kind of `payment_intent` it issues.
- **Console**: a Billing page (current subscription, the plan catalog,
  Subscribe buttons — visible to `billing.read`, owner+admin; only
  `billing.write`, owner-only, can actually pay, enforced by the SQL
  function itself) and its own console-scoped mock checkout page
  (`t/[slug]/billing/pay/[paymentId]`, distinct from Phase 6's
  agent-facing one — the owner is already signed in, so this one reads via
  RLS, no service-role bypass needed). The tenant dashboard and the Super
  Admin `/platform` page both surface subscription status now.
- **Tests**: `tests/unit/billing-entitlement.test.ts` (pure date-math
  cases: mid-trial, expired trial, the exact trial-end instant is
  exclusive, active with/without a recorded period end, `past_due`/
  `canceled` are never entitled) and `supabase/tests/009_subscriptions.test.sql`
  (structural pgTAP: RLS, zero direct write policies, all four functions
  exist, the pending-only partial index, exactly one default plan) —
  verified directly against the live project's schema, same as Sections
  14/15's, since pgTAP itself isn't installed there.
- **What Phase 7 does not include**: real recurring billing (no scheduled
  job auto-charges a card when a period ends — the owner returns to
  Billing and pays again; there is no dunning, no automatic retry, no
  invoice emails); upgrading/downgrading between plans mid-period
  (Subscribe always starts a fresh full-price payment for the chosen
  plan); a Super Admin editor for `subscription_plans` (Super Admin edits
  the seed data directly today, the same posture as `ai_model_configs`);
  and per-plan feature/usage enforcement (`subscription_plans.limits` is
  reserved but nothing reads it yet — every plan behaves identically once
  active).

## 17. Deterministic-first structured UI (ahead of Phase 8)

Per instruction, before Phase 8: category navigation, product browsing,
price display, cart operations and checkout must never invoke the LLM —
only genuine natural-language understanding, recommendation, ambiguity
resolution or personalization should. Until this section, every cart/order
action (Phase 5) only existed as an AI tool call — reachable exclusively
through a full gateway turn (deterministic matcher, then a model call if
that missed, then the tool). Browsing a menu by category therefore cost an
AI call every time, which is exactly backwards for both latency and spend.

- **`src/server/agent-public/catalog-actions.ts`** (new): a second,
  deterministic entry point alongside the free-text chat
  (`src/server/agent-public/actions.ts`), calling the *same* commerce
  service functions the AI tool-calling loop uses
  (`src/server/commerce/cart.ts`/`orders.ts`, `src/server/payments/service.ts`)
  directly from a button click. `runAgentGateway` — and therefore any AI
  provider, any token cost, any entry in the deterministic-vs-AI metric —
  is never reached by any of it; these actions are simply not gateway
  interactions, not "free" ones. Both this and the chat share one cart via
  the same session cookie (`src/server/agent-public/conversation.ts`,
  extracted from `actions.ts` so both callers get the exact same
  conversation).
- **Every mutating action re-checks what the AI tool handler already
  checks** — `checkout.ordering_enabled`, `fulfillment_types`, and the
  product itself re-validated against the live, tenant-scoped catalog by
  id (never trusted just because the client sent one) — so the structured
  path can never do something the conversational path would have refused.
- **`CatalogPanel`** (`src/components/agent-public/catalog-panel.tsx`,
  new): categories and the full active product list are fetched once,
  server-side, by the External Agent page itself
  (`src/app/agent/[slug]/page.tsx`) — category selection is then pure
  client-side filtering of already-loaded data, not even a network round
  trip, let alone an AI one. No cart row is created until the customer
  actually adds something (an empty cart and "no cart yet" render
  identically, so there is nothing to eagerly create on page load — a
  visit that never orders costs nothing beyond the initial catalog read).
- **The greeting is plain server-rendered text** (`tenant_settings.agent.greeting`),
  shown once above the panel alongside the category browser — both are
  there "on opening" per the instruction, and neither is an AI call.
  `ChatPanel`'s own greeting bubble is suppressed (`null`) to avoid
  showing it twice; the chat remains exactly what it was (deterministic
  matcher → AI+tools) for whatever a customer types instead of clicking —
  "what pairs well with X", a complaint, a request for a human.
- **What this section does not include**: variants and modifiers — the
  catalog schema (`products`/`categories`, Phase 2) has no concept of
  either yet, so there is nothing to gate. Whenever they are added, the
  same shape applies directly: a variant/modifier picker is more
  structured UI state, and confirming a selection is another deterministic
  Server Action, never a reason to invoke the model. Also unchanged: the
  AI tool-calling loop itself (`src/server/ai/tools/`) still exists as-is
  for the chat surface, and the deterministic-first *matcher* (Phase 3,
  `src/server/ai/deterministic/match.ts`) is untouched — this section adds
  a second, independent way to reach zero-AI-cost outcomes, it does not
  change the first.

## 18. Phase 8 implementation notes (Subscriber Admin)

The `staff.read`/`staff.write`/`audit.read` permissions and their role
grants have existed since Phase 1 (business_owner gets everything,
business_admin gets all but `staff.write`, `staff` gets none of the
three) — nothing before this phase ever built a write path or a UI for
them. An audit before starting confirmed all three were genuinely
unbuilt, not just unused.

- **Staff invitations, with no email-sending integration** (same MVP
  posture as Phase 6's mock payment provider): `create_staff_invite`
  (SQL, SECURITY DEFINER, `staff.write`) generates a token and returns it
  once; the owner/admin copies the resulting link
  (`app.<root>/<locale>/invite/<token>`) and sends it themselves rather
  than the platform emailing it. `accept_staff_invite` requires the
  signed-in visitor's own `auth.users.email` to match the invite's —
  a leaked link cannot be redeemed by anyone else — and is idempotent via
  `on conflict (tenant_id, user_id)`, so re-inviting an existing member
  just updates their role rather than erroring. Neither
  `create_staff_invite` nor `update_staff_member_role` will ever issue or
  reassign the `business_owner` role — ownership is not transferable
  through this flow — and `set_staff_member_status`/`update_staff_member_role`
  both refuse to touch a `business_owner` row at all (disabling the owner,
  or changing their role, is refused outright, not just discouraged).
  Confirmed live: the full invite → wrong-email rejection → correct
  accept → promote-to-admin → attempt-to-disable-the-owner (refused)
  lifecycle.
- **`profiles.email`** (new column): `auth.users` is not exposed via
  PostgREST/RLS to a regular signed-in user, so a staff directory had no
  way to show a fellow member's email without denormalizing it onto the
  one profile table that already is exposed — populated by the same
  trigger that already creates a profile row on signup, backfilled for
  existing users. The `profiles_select` policy is extended (`alter
  policy`, not a new one) so a fellow *active* member of any shared
  tenant can see it, alongside the existing "see your own, Super Admin
  sees all" clauses. Confirmed live under real RLS enforcement (not
  superuser bypass): a newly-accepted staff member could read the
  owner's profile row.
- **Business profile** (`src/app/console/[locale]/t/[slug]/settings/page.tsx`,
  extended): contact email/phone, website, timezone, country, city —
  needed no new migration at all. The `tenants_update` RLS policy (Phase
  1) already requires `settings.write`, the exact permission checkout
  settings already relies on for the same reason; `updateBusinessProfileAction`
  is a plain RLS-scoped update, same shape as `updateCheckoutSettingsAction`.
- **Audit log** (`src/app/console/[locale]/t/[slug]/audit/page.tsx`, new):
  read-only, no new migration — the `audit_logs_select` policy already
  requires `audit.read` or Super Admin, so the page needs no permission
  check of its own; a member without it simply sees an empty table.
- **A real pre-existing bug found and fixed while building this**:
  `ConsoleEntry` (`src/app/console/[locale]/page.tsx`) redirected a
  returning, already-onboarded owner to `/${locale}/console/t/${slug}` —
  an *internal*, already-rewritten path, not the external one
  `src/proxy.ts`'s host-based rewrite expects to receive and rewrite
  itself. Every sign-in since Phase 1 hit this; it was never manually
  exercised end to end before now, since Phase 8's invite-accept flow
  redirects through this exact entry point after a fresh sign-up. Fixed
  to redirect to `/${locale}/t/${slug}` — the external path in every
  other redirect in this codebase already uses correctly.
- **`signInAction`/`signUpAction`** (`src/server/auth/actions.ts`)
  gained an optional `redirectTo`, guarded to a same-origin relative path
  only (`startsWith("/")`, rejecting `//`) — an open-redirect guard, not
  an assumption of trust. This is what lets the invite-accept page send
  someone who isn't signed in through sign-in/sign-up and back to the
  same invite link afterward, without giving either action a reason to
  know anything about invites specifically.
- **Tests**: `supabase/tests/010_staff_admin.test.sql` adds structural
  pgTAP checks (RLS, zero direct write policies, all five functions
  exist, token stored only as a unique hash, both owner-protection guards
  present in the function source, `profiles.email` and
  `staff_invites.expires_at` exist) — verified directly against the live
  project's schema, same as every phase since Section 14, since pgTAP
  itself isn't installed there. The invite/role/status lifecycle itself
  was exercised with real data (not just schema shape) directly against
  the live project, including the wrong-email rejection and both
  owner-protection guards actually firing.
- **What Phase 8 does not include**: real email delivery for invites (a
  Resend/SES integration is a natural later addition — the link itself
  is already the whole mechanism, only its delivery channel would
  change); ownership transfer (no function ever reassigns
  `business_owner`); custom/tenant-defined roles (`roles.tenant_id` has
  supported a non-null tenant-scoped row since Phase 1's schema, but
  nothing creates one — every assignable role today is still one of the
  three system roles); and self-service password reset (unrelated to
  this phase's scope, still just `signInWithPassword`/`signUp`).

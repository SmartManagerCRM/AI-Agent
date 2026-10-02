# Deployment

Target: **Hostinger shared hosting**, using hPanel's Node.js application
feature. This app is a single Next.js server (no separate backend) whose
`src/proxy.ts` tells three different hostnames apart by their `Host` header
— the platform marketing site, the subscriber console, and the standalone
Agent — so deployment is really "run this one build three times, once per
hostname."

> Hostinger's panel labels and steps change over time and differ between
> plans. What follows is accurate as of this writing but treat the exact
> button names as approximate — match them to whatever your panel actually
> shows, and use Hostinger's own help center if something's moved.

## 1. What gets deployed

`next.config.ts` sets `output: "standalone"`, so the build produces a
self-contained server instead of relying on `next start` against a full
`node_modules` tree — a better fit for shared hosting's tighter resource
caps. Build it with:

```bash
npm ci
npm run build:standalone
```

This runs `next build` and then copies `public/` and `.next/static/` into
`.next/standalone/` (the generated `server.js` doesn't include those by
default — see the `output` doc in `node_modules/next/dist/docs/01-app/
03-api-reference/05-config/01-next-config-js/output.md`). The result,
`.next/standalone/`, is the entire deployable artifact: it does **not**
need `node_modules` installed separately on the server, since Next already
traced and copied the runtime dependencies it actually needs into it.

> **Why `next build` here actually runs Webpack, not Turbopack**: both
> `build` and `build:standalone` pass `--webpack` explicitly. This
> version of Next.js defaults `next build` to Turbopack, but on at least
> one real deploy attempt (Hostinger's zip-upload/auto-build path, Node
> 22.x, "Default" build settings) Turbopack's build crashed with `FATAL:
> An unexpected Turbopack error occurred` while processing
> `src/app/globals.css` — a child process Turbopack spawns for the
> PostCSS transform exited silently, with no useful error. This is **not**
> a Tailwind/PostCSS misconfiguration in this project: `tailwindcss`
> (4.3.3), `@tailwindcss/postcss`, and `postcss` (8.5.x) were all already
> well past every version a few "fix" suggestions floating around this
> error message ask you to upgrade to, and `postcss.config.mjs` already
> had the recommended config — none of that was the cause. Proof: the
> exact same code, unchanged, builds cleanly under Webpack. If your
> hosting platform runs its own build command instead of reading
> `package.json`'s `scripts.build` (check for a "custom build command"
> field under its build settings), set it explicitly to
> `next build --webpack` there too.

**Build once, deploy the same artifact everywhere.** Don't run
`npm run build:standalone` separately for each of the three hostnames below
— copy the one `.next/standalone/` output to all three app roots. Next
generates a random build ID per build; three independently-built copies
would carry mismatched IDs, which can surface as spurious "failed to find
Server Action" errors if a request ever crosses between them.

## 2. DNS

Point all three at your Hostinger server's IP:

| Hostname | Serves |
|---|---|
| `yourdomain.com` (root) | Platform marketing site |
| `app.yourdomain.com` | Subscriber console + Super Admin |
| `yourdomain.com/agent/<business-slug>` | Customer-facing External Agent (canonical; path-based, **no extra DNS record needed**) + embeddable widget at `/agent/widget/<slug>` |
| `agent.yourdomain.com` *(optional, later)* | Only if you create and verify this DNS record — then set `AGENT_URL=https://agent.yourdomain.com` and every Agent link/QR/widget uses it |

**Go live.** A public Agent URL only opens once the business has published its Agent (console → Business Brain → *Go live* → **Publish Agent**, or the Agent page). Until then `/agent/<slug>` shows "Agent not live yet"; a paused Agent shows "Agent temporarily unavailable"; an unknown slug is a 404 "Business not found". Publishing is `publish_agent` (checks `agent.write`, the minimum launch requirements, and starts the default free trial if the business has no subscription); pausing is `pause_agent`. The state lives in `agent_deployments`.

`PLATFORM_ROOT_DOMAIN`, `CONSOLE_SUBDOMAIN`, `AGENT_SUBDOMAIN` (below) must
match whatever you actually configure here.

## 3. hPanel: three Node.js applications

Shared hosting's Node.js App feature ties one application instance to one
domain/subdomain. Since all three hostnames need to run the exact same
code (they're told apart at request time by `src/proxy.ts`, not by
being different apps), create **three separate Node.js applications** in
hPanel, one per hostname, all pointed at the same uploaded `.next/standalone/`
build:

1. hPanel → **Advanced → Node.js** → **Create Application** (×3).
2. For each: pick the Node version (≥ 20.9, matching this repo's `engines`
   field), set the domain/subdomain, and set the **Application startup
   file** to `server.js` inside that app's copy of `.next/standalone/`.
3. Set the environment variables below in each application's own env-var
   panel (all three need the same values — a Super Admin session, for
   instance, is expected to work identically regardless of which
   subdomain issued it).
4. Start (or restart) each application after every deploy.

This does mean three separate Node processes rather than one — an accepted
tradeoff of shared hosting's per-domain app model, not a bug. One concrete
consequence: `src/server/shared/rate-limit.ts`'s in-process rate limiting
is now partitioned three ways (once per hostname) instead of shared across
one process — already a documented limitation for any multi-instance
deployment (see `ARCHITECTURE_ASSESSMENT.md` §21), just worth knowing it
applies here from day one, not only once you scale further.

## 4. Environment variables

Start from `.env.example` (every variable is documented there). Set these
identically across all three Node.js applications:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase project's URL (see DATABASE_SETUP.md) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the project's publishable key |
| `SUPABASE_SECRET_KEY` | the project's service-role secret key |
| `PLATFORM_ROOT_DOMAIN` | `yourdomain.com` |
| `CONSOLE_SUBDOMAIN` | `app` |
| `AGENT_SUBDOMAIN` | `agent` |
| `AGENT_URL` | leave **unset** (Agent links are `https://yourdomain.com/agent/<slug>`). Set only after a dedicated Agent domain's DNS record exists and is verified. |
| `CONSOLE_URL` | only if your plan can't serve `CONSOLE_SUBDOMAIN` as a real subdomain — set to your root domain (e.g. `https://yourdomain.com`, no subdomain) and every console/staff link uses that instead. Leave unset otherwise. |
| `PUBLIC_URL_SCHEME` | `https` |
| `PUBLIC_URL_PORT` | leave unset (only needed for a non-default port, e.g. local dev) |
| `GEMINI_API_KEY` | paid-tier Gemini key (optional — AI features degrade to "not configured" without it) |
| `ANTHROPIC_API_KEY` | optional fallback provider |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | generate once with `openssl rand -base64 32`, reuse the same value everywhere — required correctness insurance for this three-instance setup (§3), even though a shared build artifact makes it unlikely to bite in practice; see `.env.example` |
| `PORT` | set automatically by hPanel to whatever port it assigns your app — don't override it |

Get the Supabase keys from the Supabase dashboard for your project →
Project Settings → API (see DATABASE_SETUP.md for provisioning the
project itself). `SUPABASE_SECRET_KEY` is sensitive (service-role) — set
it only in hPanel's env-var panel, never commit it.

## 5. Manual deploy runbook

Since this is checks-only CI (`.github/workflows/ci.yml` runs typecheck/
lint/test/build on every push/PR — it does not deploy), shipping a change
is a manual step:

```bash
# 1. On your machine (or via Hostinger's SSH terminal, if your plan has one):
git pull origin main
npm ci
npm run build:standalone

# 2. Upload .next/standalone/ to each of the three hPanel application roots
#    (SSH/SFTP, or hPanel's File Manager).

# 3. Restart each of the three Node.js applications in hPanel.

# 4. Verify: curl each hostname's /api/health and confirm {"status":"ok"}.
```

`/api/health` (`src/app/api/health/route.ts`) checks real Supabase
connectivity — a 503 there after a deploy means the env vars on that
specific app instance are wrong or the Supabase project is unreachable,
not that the deploy itself failed.

## 6. What CI does and doesn't cover

`.github/workflows/ci.yml` runs on every push/PR to `main`:
typecheck → lint → unit tests → build, using placeholder env values (never
real secrets — nothing in the build path makes a network call, since every
route in this app is dynamically rendered, not statically generated).

Not covered by CI: pgTAP tests (`supabase/tests/`, need a local Postgres —
run with `npm run test:db`) and Playwright e2e (`npm run test:e2e`). Both
are run manually today; wiring either into CI is a reasonable future
addition, not something this pass includes.

## 7. Manual configuration checklist (must be done after every fresh deploy)

Nothing below is code — these are one-time, human steps a deploy cannot
automate:

- [ ] **Database provisioned and migrated** — see `DATABASE_SETUP.md` in
      full (project creation, applying all 29 migrations in order,
      verifying reference data landed).
- [ ] **Supabase Auth email/SMTP configured** — the built-in sender is
      rate-limited and shows a generic "via supabase.io" address; set a
      real SMTP provider before onboarding real users (`DATABASE_SETUP.md` §4).
- [ ] **First Super Admin bootstrapped** — a genuine chicken-and-egg step;
      the normal "add an admin" path requires already being one. See
      `DATABASE_SETUP.md`'s bootstrap section (one direct SQL `insert`).
- [ ] **DNS for all three hostnames** (§2 above) pointed at the server.
- [ ] **All three Node.js applications created in hPanel** (§3), same
      build artifact, same env vars, all started.
- [ ] **Per-tenant payment setup is NOT a deploy step** — each business
      enables Moyasar/Tap/Cash on Delivery/Pay on Table and enters its own
      gateway credentials from its own console Settings page, after it
      signs up. Nothing to configure platform-wide for this.
- [ ] **Moyasar/Tap webhook signature verification should be confirmed
      against a real sandbox delivery before either takes live traffic** —
      flagged in `ARCHITECTURE_ASSESSMENT.md` §22: this codebase's
      Moyasar/Tap integration was built from documentation this
      development environment's network access couldn't fully verify live
      (see that section for exactly which piece and why). Low risk for
      Moyasar (its check is a direct secret comparison, well-corroborated);
      worth a real test delivery for Tap before relying on it for live
      charges.
- [ ] **`npm audit`** — clean (0 vulnerabilities) as of this package's
      build; re-run it if you update any dependency before going live, or
      periodically thereafter, since new vulnerabilities get disclosed
      against unchanged code all the time.

## Known limitations at this deploy target

- **Rate limiting is per-process**, so it's partitioned three ways here
  (§3 above) — acceptable for an MVP's traffic levels, not a shared/
  distributed limiter.
- **No CDN** in front of static assets — Hostinger serves them directly
  from `.next/standalone/.next/static/`. Fine at MVP scale; revisit if
  asset load time becomes a problem.

## Installable app (PWA)

The console (subscriber dashboard and Super Admin) installs as an app;
the customer-facing Agent and the marketing site are not offered for
install (only the console's pages link the manifest).

- **Files**: `/manifest.webmanifest` (`src/lib/pwa/manifest.ts`), `/sw.js`
  (`src/lib/pwa/service-worker.ts`, stamped with the build id), icons in
  `public/icons/`, `public/favicon.ico`. Regenerate the icons from the
  official logo with `node scripts/generate-pwa-icons.mjs`.
- **Needs HTTPS** on the console host (Hostinger's SSL); browsers only
  register service workers and offer install on secure origins.
- **Opens at** `/subscriber`: a signed-in user lands on their own business
  (or Super Admin), anyone else on the login page.
- **Caches only** the build's static files and icons — never pages, API
  responses, auth, orders, customers or payments. Offline, a page load
  shows "You're offline. Some AI Agent features require an internet
  connection."
- **Updates**: after each deploy, open apps show "New version available —
  Refresh"; nothing reloads until the user clicks it.
- **Nothing to configure**: no environment variables, no hPanel settings.

## Real-time notifications (order / subscriber / upgrade sounds)

- **Database**: `supabase/migrations/20261001190000_realtime_notifications.sql`
  (already applied to production). Triggers on the order and subscription
  state machines write `notification_events`; the table is in the
  `supabase_realtime` publication and RLS limits each console to its own
  business's orders (`orders.read`) or, for platform events, Super Admin.
- **Nothing to configure**: no environment variables. Supabase Realtime is
  on by default for the project; the browser connects with the signed-in
  user's session.
- **Sounds** are local files in `public/sounds/` (regenerate with
  `node scripts/generate-notification-sounds.mjs`).
- Browsers only play sound after the user interacts with the page: the
  console shows "Enable sound" until then, and alerts stay visual.

## Console: Brain → catalog, manual orders, file imports

- **Database**: `supabase/migrations/20261002090000_console_catalog_and_manual_orders.sql`.
- **Business Brain → pages**: when an analysis ends, the products and services
  it found are added to the catalog as drafts (never shown to customers);
  approving them in the Brain activates them, rejecting archives them. Open
  console pages refresh by themselves (Realtime event `brain_analysis_finished`).
- **Manual orders**: Orders → "Add order" / "Bulk add orders" (CSV, all or
  nothing), priced by `create_manual_orders` exactly like checkout.
- **File import**: Products & Services (and Bookings) → upload an HTML or text
  PDF price list; parsed by rules only — no AI calls, no AI cost. Scanned
  (image-only) PDFs are refused with an explanation. Uploads up to 8 MB
  (`serverActions.bodySizeLimit` in `next.config.ts`).

## Products & Services: edit / suspend / delete, Brain items in other currencies

- **Database**: `supabase/migrations/20261003090000_catalog_item_controls.sql`
  (already applied to production).
- Every product and service has **edit**, **suspend / activate** and
  **delete** icons. Suspended items are not shown to customers and are not
  re-activated by "Activate all drafts" or by a Brain approval. Delete keeps
  the row (`products.status = 'archived'`, `bookable_services.archived_at`) so
  past orders and bookings still show what was sold, and the Business Brain
  or a file import never adds it back.
- **Brain → catalog** also runs when a finding is approved, and on demand
  with "Add from Business Brain" (for findings approved before this existed).
- A Brain finding or imported line **priced in another currency** is never
  converted: it is added as a draft marked "Price needed · listed as USD 15.00"
  (`products.source_price`). The database refuses to put it on sale (or in a
  manual order) until the owner sets their own price.

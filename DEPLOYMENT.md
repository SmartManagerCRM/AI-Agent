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
| `ELEVENLABS_API_KEY` | ElevenLabs API key for the Agent's premium voice (optional — without it the Agent speaks with each customer's device voice). Server-side only. |
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
- **Phone locked / console in the background**: browsers never let a
  website play its own sound there. New orders then raise a system
  notification (phone's notification sound + vibration, kept on screen),
  and the order sound plays as soon as the console is back in front (for
  orders up to 10 minutes old, once). Settings → "Order alerts on this
  device" has a test-sound button and "Keep the screen on" (Wake Lock) for
  a phone or tablet at the counter.

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

## Product photos

- **Database**: `supabase/migrations/20261003120000_product_images.sql` (already
  applied to production) — `products.image_path` / `image_source_url` and the
  public-read Storage bucket `catalog-images`. There is no write policy on the
  bucket: only the server writes, with `SUPABASE_SECRET_KEY` (already required
  for Business Brain jobs), under the product's own `<tenant_id>/` folder and
  only after the product update succeeded under the user's own RLS session.
- **Where photos come from**: the photo next to each item on a menu page
  (img / lazy-load / srcset / background image / JSON-LD `image` / embedded
  catalog JSON) — read by the Business Brain and by HTML file imports — or an
  upload in the product's edit form (JPG/PNG/WebP, ≤ 6 MB).
- Every photo is downloaded server-side through the SSRF-guarded fetcher,
  checked by its bytes (no SVG), re-encoded to WebP ≤ 1000 px with `sharp`
  (metadata stripped) and stored in the bucket; customers' browsers never load
  images from the source site.
- An HTML file whose photos use relative paths needs its web address
  (`<base>`, canonical or og:url link) to find them; otherwise the import says
  so. PDFs: text only, no photos.

## Business currency (header picker)

- **Database**: `supabase/migrations/20261003150000_business_currency_switch.sql`
  (already applied to production): 78 currencies (MENA + international, ISO
  4217 exponents), `tenant_currency_changes` (each switch with its full rate
  snapshot), `change_business_currency()` and currency-aware report functions.
- The currency picker in the subscriber console header switches the business's
  selling currency and **converts** product and service prices, the delivery
  fee, the minimum order and fixed-amount coupons in one transaction. Drafts
  waiting for a price listed in the new currency get that price exactly. Past
  orders keep their own currency; dashboard / analytics / customer / coupon
  totals express them in the current currency at the rates saved by the switch.
- `tenants.currency` can no longer be changed by a plain update (a trigger
  refuses it) — only through the converting switch (`settings.write`).
- **Exchange rates**: free, keyless public feeds — `open.er-api.com` (daily),
  falling back to the `@fawazahmed0/currency-api` feed on jsDelivr and its
  pages.dev mirror; cached for an hour. No API key or environment variable.
  The server needs outbound HTTPS to those hosts; if none answers, the switch
  is refused and nothing changes (rates are never guessed). The confirmation
  dialog credits "Rates By Exchange Rate API" as its terms require.

## Customer Agent: voice

- Customers can tap the mic in the chat and speak: their **own browser**
  transcribes (Web Speech API) and the transcript is sent like a typed
  message, through the same deterministic-first chat. Replies to spoken
  messages are read aloud by the browser (`speechSynthesis`); every reply
  also has Listen / Stop. No audio is sent to an AI model, so voice costs
  exactly what typing costs. Spoken turns are stored with
  `conversation_messages.modality = 'voice'`.
- Recognition asks the browser for its top 5 guesses and sends the one
  naming the most of the business's own products/categories/services and
  ordering words ("add", "cart", "أضف", "panier"…); the browser's first
  guess wins ties. Arabic listens in the customer's own dialect (e.g.
  ar-EG); English and French always use one standard accent (en-US,
  fr-FR), whatever other variants the phone lists.
- **Nothing to configure**: no migration, no environment variables. The
  `Permissions-Policy` header allows the microphone for the app's own pages
  only (`microphone=(self)`), and the widget embed's iframe asks for it
  (`allow="microphone"`).
- Browsers without speech recognition (e.g. Firefox, some in-app browsers)
  simply don't show the mic; typing is unchanged. The mic needs HTTPS.

## Customer Agent: language bar, background photo, spoken greeting

- **Language menu** (header, next to the cart): a dropdown showing the
  current language as letters (EN / AR / FR, never flags). The
  Agent's screens are translated into all three, so customers can always
  pick any of them (the business's enabled languages are listed first);
  the conversation switches to the picked language and the built-in
  replies (menu, hours, thanks, greeting, prices) answer in it.
- **Background photo**: Agent settings → Background photo. Re-encoded to
  WebP (≤1600 px) and stored in the existing `catalog-images` bucket under
  the business's id; the path lives in `tenant_settings.agent.background_path`
  (no migration). Shown behind the whole Agent: strongly under a dark wash
  on the landing page, softly behind the other screens and the chat.
- **Greeting**: the landing page and the conversation show the greeting
  saved in Agent settings, and the Agent reads it aloud once per visit
  (browser speech, no AI cost) — as the page opens, or at the customer's
  first tap where the browser doesn't allow speech before one. Customers
  can turn the Agent's voice off (chat header); it is remembered on their
  device.
- **Greeting per language**: Agent settings has one greeting field each
  for English, Arabic and French (`tenant_settings.agent.greetings`; no
  migration — `greeting` keeps the first one for older readers, and a
  single older greeting is read as the language it is written in). The
  Agent shows and speaks the greeting of the language the customer picked;
  a language left empty uses the built-in greeting in that language, so a
  customer who picks Arabic is never greeted with English text. Picking
  another language in the menu plays the greeting again, in it, every
  time. With the premium voice each language's greeting is generated once
  and then served from the cache.
- The landing page's "Ask" bar has a mic: it opens the conversation and
  starts listening in one tap.
- **Bookings: time in / time out** — services may have no fixed length,
  let the customer choose their time out (or a duration), take several
  people at once (capacity), price per booking / hour / person, and be
  ticked "Bookable on your Agent". Every booking goes through
  `book_service` / `book_service_at` (opening hours in the business's time
  zone, capacity under a per-service lock). The owner can book customers in
  from Bookings → New booking; customers book themselves on the Agent's
  landing page (Book tile → service details → time → details → confirm) —
  a form, never the AI, so no AI cost. Migration
  `20261005100000_bookings_time_in_out.sql`, applied.
- **Memberships** (sidebar, below Bookings) — loyalty (free or paid) and
  paid service subscriptions: price per period, joining fee, length or no
  expiry, free trial, grace period, visits per period, member discount,
  benefits, member limit, included services. Members: number, start and
  renewal dates, payment (cash/card/transfer/online), auto-renew, check-ins,
  renew, freeze/resume (frozen days added back), cancel. Plan prices follow
  a business currency switch. Permissions `memberships.read/write`
  (owner/admin write, staff read). Migration `20261005110000_memberships.sql`,
  applied.
- **Bell counts** — the console bell counts conversations with activity
  since you last opened Conversations (per person, every device;
  `inbox_reads`, migration `20261005090000_inbox_reads.sql`, applied). The
  Super Admin bell counts only alerts not yet opened on that device.
- **Ask SmartManager** (dashboard) — answers questions about sales, orders,
  best sellers, customers, bookings, members, conversations, leads,
  products, Agent status and hours, in English, Arabic or French, from the
  business's own data (`tenant_period_summary`, migration
  `20261005120000_business_answers.sql`, applied). It never calls an AI
  model — anything else gets the list of what it can answer.
- **Business logo** — Settings → Logo (owner/admin, `settings.write`): PNG,
  JPG or WebP up to 3 MB, re-encoded to WebP (≤ 512 px, transparency kept)
  in the `catalog-images` bucket as `<tenant_id>/logo-<hash>.webp`; path in
  `tenants.logo_path` (migration `20261004130000_business_logo.sql`,
  applied). Shown beside the business name in the console sidebar and
  header, and on the customer Agent's landing page; without a logo the
  business's initial is shown as before.
- **Sidebar selection** — in both the subscriber console and Super Admin,
  only the current page's link is selected (the most specific match; a
  sub-page keeps its section selected). The Super Admin role badge no
  longer uses the "selected" green.
- **Desktop Agent layout** — beside the docked chat, the landing page's
  greeting bubble shrinks with the column and product rows wrap into a grid
  (phones and tablets still swipe them sideways), so nothing is cut off at
  the edge next to the chat.
- **Premium voice (ElevenLabs)** — the production voice engine once
  `ELEVENLABS_API_KEY` is set on the Hostinger apps (migration
  `20261004090000_agent_premium_voice.sql`, already applied to production):
  - Which voice speaks is data: `voice_profiles` (one active row per gender:
    voice id, model `eleven_flash_v2_5`, voice settings, price per million
    characters). Voices: male "Chris - Charming, Down-to-Earth", female
    "Sarah - Mature, Reassuring, Confident" — both ElevenLabs built-in
    (premade) voices, which every plan may use through the API. Voice
    Library voices (e.g. the first male voice, "Rick") are refused through
    the API on lower plans with HTTP 402 (logged as `HTTP_402` in
    `agent_interactions`); migration `20261004100000_agent_male_voice_premade.sql`
    moved the male voice to a built-in voice for that reason, and
    `20261004110000_agent_male_voice_chris.sql` set it to Chris (the owner's
    pick; Eric sounded too formal). Change a voice by updating its row; no
    deploy needed.
  - Reporting: voice audio is spend, not a customer interaction. It counts
    toward the subscriber's AI cost cap, but is left out of "AI responses",
    interaction counts and the deterministic share; Super Admin sees it on
    its own (Usage: "Premium voice cost" and a per-plan column; Business 360:
    voice cost, clips, characters) — migration
    `20261004120000_voice_separate_from_ai_responses.sql`, applied.
  - Flow: Agent text → audio cache (private bucket `agent-voice`, one file per
    business + voice + language + sentence) → hit: played at once, no cost;
    miss: ElevenLabs, streamed to the customer while it is stored for next
    time. The greeting and repeated replies are generated once.
  - The page asks `POST /api/agent/voice` for sentence n of the greeting or of
    one of the Agent's own replies (never arbitrary text); the key never
    leaves the server. Interrupting stops playback at once and nothing more is
    generated.
  - Cost goes through the AI usage guard (reserve → settle) and the ledger
    (`agent_interactions.request_type = 'voice_tts'`, characters in
    `input_tokens`), so it counts toward each plan's AI limits; at the limit,
    on a provider error or with no key, the device voice is used instead.
- **Device voice** (no premium key; Agent settings → Voice: Male, the default, or Female;
  stored as `tenant_settings.agent.voice`, no migration). Spoken with each
  customer's own device voices (free): the most natural voice of the chosen
  gender in the reply's language (Edge "Natural", Apple "Enhanced",
  "Neural" voices first), recognised by the voice's name; a device whose
  voices don't say their gender (common on Android) uses its standard voice
  for the language. Replies are read sentence by sentence at a calm pace.
  "Preview voice" plays the greeting on the owner's own device.

## Customers: add, edit, delete

- Customers → **Add a customer**: name, phone, email, birthday and notes
  (walk-ins, regulars, people who call). Table `public.customers`
  (migration `20261006090000_saved_customers.sql`), RLS per business:
  owners and admins add / edit / delete (`customers.write`), staff can see
  them (`customers.read`). One saved customer per email and per phone
  number (any case / formatting).
- The list combines saved customers with the customers known from orders.
  An order is matched to a saved customer by email (any case) or phone
  (digits only), so a regular's order history shows under their saved
  profile; a customer known only from orders can be saved with one click
  ("Save as customer", pre-filled). Deleting a saved customer keeps their
  orders, listed by the details on the orders. Search matches name, phone
  or email.

## Console sidebar and favicon

- The sidebar scrolls on its own (sticky beside the page on desktop, a
  drawer on mobile): choosing a page never moves it, and its position is
  kept across navigations, when the drawer reopens, and after a reload
  (per browser tab, `sessionStorage`). Subscriber console and Super Admin.
- Favicon: PNGs `public/icons/favicon-{16,32,48}.png` are linked first, with
  `/favicon.ico?v=2` as the shortcut icon. Browsers and the host's cache can
  remember that `/favicon.ico` was missing before it was added; the fresh
  URLs aren't affected by that. Regenerate all icons with
  `node scripts/generate-pwa-icons.mjs`.

## Bookings the business confirms itself

- Bookings → service → **When a customer books on your Agent**: "Confirm
  automatically" (as before) or "I confirm each request"
  (`bookable_services.requires_approval`). Migrations
  `20261006110000_booking_approval.sql` (columns, `decide_booking`),
  `20261006110050_booking_approval_functions.sql` (booking functions) and
  `20261006110100_booking_request_alerts.sql` (the live console alert).
- With "I confirm each request", a booking made on the Agent (form or chat)
  is a request: `pending` → `confirmed` or `declined`, answered with
  `public.decide_booking` (bookings.write). A pending request holds its
  places, so confirming can never overbook. Console bookings are always
  confirmed at once.
- The customer sees "I'm checking availability for (date) at (time) for
  (people)." with a waiting animation; the page asks for the answer every
  few seconds (status only), keeps waiting if they leave and come back,
  then shows "Booking Confirmed" with the details, or a polite apology
  (the schedule is full at that date and time) with "Choose another time".
  EN / AR / FR. No AI cost.
- The request reaches open consoles at once: a `booking_requested`
  notification (same realtime path as orders, RLS: bookings.read) rings
  like a new order and shows a "Booking request" alert; the Bookings page
  lists "Booking requests waiting for you" with Confirm / Decline.
- WhatsApp on every booking line: a wa.me link with the message ready to
  send (booking confirmation, or the apology for a declined request), in
  the language the customer used on the Agent (`bookings.customer_locale`).
  A local phone number gets the business's country code (Settings →
  country); the owner presses Send in WhatsApp — nothing is sent
  automatically.

## Greeting voice: one even tone

- The whole greeting in a language is spoken as one recording (it used to be
  one per sentence, each with its own intonation — a high "Hi! I'm …" and a
  lower rest). Exclamation marks are read as full stops for the voice only.
- Greeting delivery: stability 0.6, similarity 0.8, style 0.2, speed 1.0
  (migration `20261006100000_voice_greeting_even_tone.sql`). Each greeting
  is generated once more in this delivery, then served from the cache.


## Sidebar numbers: what is still waiting

- Business console: **Orders** shows orders received but not yet completed
  (paid, confirmed, preparing, ready); **Bookings** shows bookings not yet
  fulfilled (requests waiting for an answer + confirmed bookings not yet
  marked completed) and pulses while a request waits. Hover for details.
  Counted in Postgres under the member's own permissions; updated as orders
  and requests arrive (realtime) and as soon as one is completed/answered.
- Super Admin: **Subscribers** shows new subscribers no Super Admin has
  opened yet (`platform_subscriber_checks`, Super-Admin-only; migration
  `20261006130000_subscriber_checks.sql`). Opening a subscriber checks it;
  the Subscribers page has "Mark all as checked". Subscribers that existed
  before this change count as checked.

## Premium voice: outside the AI cost cap, free tier, automatic device-voice fallback

- The plan's AI cost cap covers the **AI Agent only**. Premium voice clips
  (`voice_tts`) are still recorded in the ledger but are no longer reserved
  against the cap, and a period's AI spend is seeded/recounted without them
  (migration `20261006140000_voice_outside_ai_cost_cap.sql`, which also
  recounted the existing period counters from the ledger — repeatable).
- Super Admin → subscriber: "Costs this period" shows **AI Agent cost**
  (against the cap) and **Premium voice (ElevenLabs)** side by side. On the
  ElevenLabs free tier the voice shows as "Free" with the estimate at paid
  rates, plus the account's characters used / limit and reset date
  (read from ElevenLabs `GET /v1/user/subscription` — the API key needs the
  "User → Read" permission for this; without it the line says so).
- When the ElevenLabs characters run out (seen in the account figures, or
  ElevenLabs refusing a sentence with `quota_exceeded`), every Agent speaks
  with the customer's own device voice (free, Android/iOS/desktop standard
  voices) — the Agent page is served without premium voice and the voice
  endpoint answers "device voice" at once, without calling ElevenLabs —
  until the characters reset (or the plan is upgraded). Owners' "Preview
  voice" explains it. Nothing to configure.

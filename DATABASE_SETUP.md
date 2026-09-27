# Database Setup

This app's entire schema — tables, RLS policies, SECURITY DEFINER
functions, reference data (currencies, roles, permissions, business
types, default AI model configs) — lives in `supabase/migrations/`, in
sequence, and nowhere else. There is no separate "seed script" to run: the
migrations themselves insert the reference data as they go.

## 1. Create the Supabase project

1. Sign up / sign in at [supabase.com](https://supabase.com) and create a
   new project. Note its **project ref** (the `xxxx` in
   `https://xxxx.supabase.co`) and set a strong database password.
2. Project Settings → API: copy the **Project URL** and the
   **publishable key** (`NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
3. Project Settings → API → **service_role** secret: copy it
   (`SUPABASE_SECRET_KEY`). Treat this exactly like a root password — it
   bypasses every RLS policy in the database. Never expose it to a
   browser, never commit it.

## 2. Apply the migrations

The migrations must be applied **in filename order** — they're numbered
by timestamp and later ones depend on earlier ones (e.g. the hardening
migrations alter policies/functions the base migrations create). Two ways
to do it, in order of preference:

### Option A — Supabase CLI (recommended)

```bash
npm install -g supabase
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

`db push` applies every migration under `supabase/migrations/` that isn't
already recorded as applied, in order. This is idempotent — safe to
re-run.

### Option B — Supabase Dashboard SQL Editor

If you can't install the CLI: open each file in
`supabase/migrations/`, **in filename order** (they sort correctly as
plain strings — `20260927130001_...` before `20260927130002_...`, etc.),
paste its contents into the SQL Editor, and run it. Do not skip any, and
do not run them out of order.

Either way, when done you should have 29 migrations applied, spanning
extensions/schemas, tenancy, RLS helpers, reference data, Business Brain,
the AI Gateway, conversations, cart/orders, payments, subscriptions,
staff/Super Admin, hardening passes, and the real payment providers
(Moyasar/Tap/Cash on Delivery/Pay on Table) added most recently.

## 3. Verify

After applying, spot-check that the schema landed correctly:

```sql
-- Should return 29+ rows (one per applied migration)
select version, name from supabase_migrations.schema_migrations order by version;

-- Should return rows: currencies, business types, permissions, and the
-- system roles (business_owner, business_admin, staff) are all seeded by
-- the migrations themselves
select count(*) from public.currencies;      -- > 0
select count(*) from public.business_types;  -- > 0
select count(*) from public.roles where tenant_id is null;  -- 3 (business_owner, business_admin, staff)
select count(*) from public.permissions;     -- > 0
```

If any of these come back empty, a migration was skipped or failed
partway — check the SQL Editor's error output and re-run from where it
stopped (each migration is written to be safe to re-run individually if
it fails before completing; check the specific error rather than
re-running earlier ones, which may error on already-existing objects).

### Known, harmless bookkeeping note

The live project this app was developed against has 30 entries in its
migration history table, one more than the 29 files in
`supabase/migrations/`. The extra entry (`real_payment_providers_fix`) was
a mid-development bug fix applied directly via a database tool and never
saved as its own file, because the fix was folded into the *already
unreleased* `..._real_payment_providers.sql` file before it was ever
committed. The live function definition was confirmed byte-for-byte
identical to what that single committed file produces — applying the 29
committed files to a fresh project gives you the exact same schema, just
without that one extra bookkeeping row. Nothing to do here; noted for
transparency, not because any action is needed.

## 4. Configure Supabase Auth (do this before real users sign up)

The app uses Supabase's own email/password auth (`supabase.auth.signUp`/
`signInWithPassword`) — no custom auth code. Two things to set in the
Supabase Dashboard before going live:

- **Auth → Providers → Email**: confirm "Confirm email" matches what you
  want (MVP default assumes email confirmation is required before
  sign-in works).
- **Auth → Emails → SMTP Settings**: Supabase's built-in email sender has
  a low rate limit and shows "via supabase.io" as the sender — configure
  a real SMTP provider (Resend, Postmark, SES, etc.) here before
  onboarding real businesses, or confirmation/invite emails may not
  arrive reliably at any real volume.

## 5. What's NOT part of database setup

- **Payment gateway credentials** (Moyasar/Tap secret keys) are entered
  per-tenant, in the console's own UI (Settings → Payment methods) after
  a business signs up — never a database seed step.
- **AI provider API keys** (`GEMINI_API_KEY`/`ANTHROPIC_API_KEY`) are
  environment variables (`.env.example`), not database rows — the
  `ai_model_configs` *table* (which model serves which request kind) is
  seeded by migration `20260927150002_ai_model_seed.sql`, but the actual
  API keys used to call those models are not.
- **Platform admin accounts — genuine bootstrap step, do this once.** There
  is no seeded Super Admin account, and `add_platform_admin()` (the normal
  way to grant it) itself requires the caller to *already be* a Super
  Admin — by design, so a compromised regular account can never grant
  itself platform access. This means the very first Super Admin can only
  be created by inserting directly into `platform_admins`, bypassing that
  function, using the Supabase SQL Editor (which runs as the Postgres
  superuser and isn't subject to the function's own permission check):
  1. Sign up for a normal account through the app first (so a row exists
     in `auth.users`).
  2. In the Supabase Dashboard's SQL Editor, run:
     ```sql
     insert into public.platform_admins (user_id, level)
     select id, 'owner' from auth.users where email = 'the-first-admins-email@example.com';
     ```
  3. Sign in to the console — the Super Admin area (`/platform`) is now
     reachable. Every subsequent admin can be added normally, from inside
     the app, via `add_platform_admin()` (Super Admin console UI), now
     that one exists.

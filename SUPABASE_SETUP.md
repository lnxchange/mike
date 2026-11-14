# Supabase Setup

This document walks through setting up a **brand new** Supabase project for Mike, end to
end. It's intentionally step-by-step so it works for a first-time Supabase user testing
this fork.

For an **existing** Mike deployment, do not run `backend/schema.sql` — see
"Existing databases" at the bottom instead.

## What Supabase is used for

- **Auth**: email/password sign-up and sign-in (Supabase Auth). The frontend talks to
  Supabase directly for this.
- **Postgres**: all application data (projects, documents, chats, workflows, tabular
  reviews, per-user API keys, …). The backend is the only thing that talks to Postgres,
  always using the service role key.
- **Not used**: Supabase Storage. File uploads (PDFs, DOCX, generated documents) go to an
  S3-compatible bucket instead (Cloudflare R2 by default) — see "Storage" in `README.md`
  and `API_BOUNDARY.md`. You do not need to create any Supabase Storage buckets.

## 1. Create the project

1. Go to [supabase.com](https://supabase.com/) and create a new project (any region).
2. Use a disposable/test project for local development and Vercel preview testing — see
   `docs/safe-local-testing.md` for why.
3. Wait for provisioning to finish (usually under two minutes).

## 2. Apply the schema

1. In the Supabase dashboard, open **SQL Editor**.
2. Open `backend/schema.sql` from this repo, copy its entire contents, and paste it into
   a new SQL query.
3. Run it.

This single file is idempotent-ish for a fresh database (`create table if not exists`,
`drop policy if exists` before every `create policy`, etc.) and sets up:

- **Extension**: `pgcrypto` (for `gen_random_uuid()`).
- **Tables**: `user_profiles`, `user_api_keys`, `projects`, `project_subfolders`,
  `documents`, `document_versions`, `document_edits`, `workflows`, `hidden_workflows`,
  `workflow_shares`, `chats`, `chat_messages`, `tabular_reviews`, `tabular_cells`,
  `tabular_review_chats`, `tabular_review_chat_messages`.
- **Auth integration**: a `handle_new_user()` trigger on `auth.users` that automatically
  creates a `public.user_profiles` row for every new signup (never blocks signup if it
  fails).
- **Row Level Security**: enabled on every table, with policies scoped to the
  authenticated user (`auth.uid()`) or explicit sharing (`shared_with` email lists,
  workflow shares). See "Access model" below for why RLS is defense-in-depth here, not the
  primary access control.
- **Storage buckets**: none — not applicable, see "What Supabase is used for" above.
- **Edge Functions**: none used by this app.

You do not need to run anything else for a fresh project. There is no seed data — the
first user account you create becomes the first row in `auth.users` /
`public.user_profiles`.

## 3. Get your API keys

In **Project Settings > API**:

| Value | Where it goes | Notes |
|---|---|---|
| Project URL | `SUPABASE_URL` (backend) and `NEXT_PUBLIC_SUPABASE_URL` (frontend) | Safe to expose publicly |
| `anon` / `public` key | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (frontend) | Safe to expose publicly — RLS protects data, not key secrecy |
| `service_role` key | `SUPABASE_SECRET_KEY` (backend, and optionally frontend) | **Secret.** Bypasses RLS. Never expose to a browser or commit it |

If your project shows Supabase's newer key formats (e.g. `sb_publishable_...` /
`sb_secret_...`) alongside legacy JWT-style keys, use the **legacy JWT-style** anon and
service role keys — that's what `@supabase/supabase-js` in this codebase expects.

Put these into `backend/.env` and `frontend/.env.local` as described in
`backend/.env.example` / `frontend/.env.local.example` and the root `README.md`.

## 4. Disable email confirmation for local testing (optional but recommended)

Supabase Auth sends a confirmation email on signup by default. For fast local iteration:

1. Go to **Authentication > Providers > Email**.
2. Turn off "Confirm email".

For anything beyond local testing, leave confirmation on and configure custom SMTP
(**Authentication > Emails**/**Settings**) — Supabase's built-in mailer is rate-limited and
not meant for production traffic.

## 5. Verify the connection

Run the built-in health check from the backend once `backend/.env` is filled in:

```bash
npm install --prefix backend   # if you haven't already
npm run check:supabase --prefix backend
```

This is a **read-only** script. It checks, in order:

1. `SUPABASE_URL` / `SUPABASE_SECRET_KEY` are set.
2. The service role client can connect and query `public.user_profiles`.
3. Every table from `backend/schema.sql` is reachable.
4. The service role key can call the Supabase Auth admin API (confirms it's really the
   service role key, not the anon key).
5. Object storage env vars are present (warning only — the app still runs without them,
   just with uploads/downloads disabled).

Example output when everything is set up correctly:

```
Mike / Supabase health check

[PASS] Environment variables — SUPABASE_URL=https://your-project.supabase.co
[PASS] Connectivity — Connected to Supabase and queried public.user_profiles successfully.
[PASS] Table: user_profiles — reachable
...
[PASS] Auth admin API — Service role key can call the Auth admin API.
[PASS] Object storage config — R2_BUCKET_NAME=mike

All required checks passed.
```

If a table check fails, re-run `backend/schema.sql` in the SQL editor — it's safe to
re-run. If the connectivity or Auth admin check fails, double check `SUPABASE_URL` and
that `SUPABASE_SECRET_KEY` is the **service role** key, not the anon key.

## 6. Access model (why RLS isn't the whole story)

The frontend never queries Postgres directly — it only uses Supabase for auth. All
application data flows through the Express backend (`backend/src/middleware/auth.ts`
verifies the Supabase JWT on every request), which then uses the **service role** client
for all reads/writes. Because of this:

- RLS policies on every table are still enabled and correct (defense-in-depth, and useful
  if you ever grant direct table access to the `authenticated` Postgres role).
- `backend/schema.sql` explicitly `revoke`s all table grants from `anon` and
  `authenticated` at the end, so even a leaked anon key cannot read or write application
  data directly against Postgres — only through the backend API, which enforces
  authorization in application code plus RLS as a second layer.

Keep this in mind if you build a mode.law integration that talks to Supabase directly
instead of through this backend: you would need to either grant the relevant table
privileges back, or (safer, and the intended path — see `API_BOUNDARY.md`) keep talking
to this repo's HTTP API instead of touching its database directly.

## 7. Existing databases (not a fresh project)

Do **not** run `backend/schema.sql` against a database that already has Mike's schema
applied — it's designed for fresh databases only. The root `README.md` and
`backend/schema.sql`'s header both reference `backend/migrations/` for incremental
updates; note that **this directory does not currently exist in this repository** (see
`SETUP_AUDIT.md` "Known gaps"). If you're tracking upstream and need incremental
migrations, diff `backend/schema.sql` against your current schema and apply the
difference by hand, or restore/recreate a `backend/migrations/` directory from your own
deployment history.

## 8. Cleaning up a test project

When you're done testing:

- Delete the Supabase project (or just the rows you created), per
  `docs/safe-local-testing.md`.
- Delete the corresponding storage bucket contents if you tested uploads.
- Rotate/delete any model provider keys you used for testing.

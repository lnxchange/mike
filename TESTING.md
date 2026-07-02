# Testing

This documents what was actually run and verified in the sandboxed environment used to
make this change, what passed, and what remains unresolved because it needs real
credentials/services this environment doesn't have.

## Environment constraints

This work was done in a sandboxed cloud agent environment with:

- No Supabase account/API access (no Supabase CLI, no Supabase MCP server available).
- No Docker (so no local Supabase stack via `supabase start`, and no local Postgres to
  apply `backend/schema.sql` against directly).
- No Vercel account access with deploy permissions (the Vercel MCP integration was in an
  error state at the time of this work).
- Outbound network access to npm's registry (confirmed working — used to install
  dependencies and check package version ranges).

Because of this, testing below is split into what was verified directly, and what is
documented but requires the repo owner to run once real Supabase/Vercel credentials are
available (see `README.md` "Quick start" and `SUPABASE_SETUP.md`).

## What was tested and passed

### Install & build

- `npm install --prefix backend` — succeeds cleanly.
- `npm install --prefix frontend` — **failed before this change** (`ERESOLVE` peer
  dependency conflict between the pinned `next@16.0.3` and `@opennextjs/cloudflare`'s peer
  requirements). Fixed by bumping `next`/`eslint-config-next` to `16.2.9`. Confirmed
  `npm install --prefix frontend` now succeeds cleanly with no `--legacy-peer-deps` flag
  needed.
- `npm run build --prefix backend` (`tsc`) — succeeds, no type errors.
- `npm run build --prefix frontend` (`next build`) — **failed before this change** when no
  Supabase env vars were set (`supabaseUrl is required.` crashed the entire build while
  prerendering `/account/models`). Fixed in `frontend/src/lib/supabase.ts` (see
  `SETUP_AUDIT.md` item 2). Confirmed `next build` now succeeds **both with and without**
  Supabase env vars set, producing the expected static/dynamic route manifest (14 routes).
- `npm run typecheck --prefix backend` / `npm run typecheck --prefix frontend` (both newly
  added) — both pass with zero errors.

### Backend startup behavior

- Started the backend with **no env vars set** — confirmed it now exits immediately
  (`process.exit(1)`) with a clear message listing exactly which required variables
  (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`) are missing and where to find them, instead of
  starting into a broken state (new behavior, `backend/src/lib/env.ts`).
- Started the backend with a full set of **syntactically valid but fake** env values
  (fake Supabase URL, fake R2 credentials, fake Gemini key) — confirmed it starts cleanly,
  logs `Mike backend running on port 3001`, and:
  - `GET /health` returns `{"ok":true}`.
  - `GET /projects` (a protected route, no `Authorization` header) returns `401` with a
    clear JSON error body, not a crash.
  - CORS preflight (`OPTIONS /projects` with `Origin: http://localhost:3000`) returns
    `204` with `Access-Control-Allow-Origin: http://localhost:3000` and
    `Access-Control-Allow-Credentials: true`, confirming the frontend/backend origin
    pairing documented in `README.md`/`.env.example` actually works.

### Frontend startup & routing behavior

- Started `next dev` with **no env vars set** — server starts, homepage (`/`) correctly
  redirects (307) to `/assistant`, `/login`/`/signup`/`/support` all return `200`, and the
  console shows the new clear warning about missing Supabase config instead of a crash.
- Started `next dev` with fake-but-valid env vars (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `NEXT_PUBLIC_API_BASE_URL` pointed at the
  locally running backend from the step above) — confirmed:
  - Homepage loads and redirects as expected; `<title>Mike - AI Legal Platform</title>`
    renders correctly (sourced from the new `frontend/src/config` layer, confirming the
    branding wiring works end to end without changing the visible output).
  - `/login` and `/signup` pages render (`200`), including the terms/privacy links now
    sourced from `appConfig.externalLinks`.
  - A simulated sign-up call against the fake Supabase URL fails with a network/DNS error
    (expected, since the URL doesn't resolve to a real project) and is caught by the
    existing `try/catch` in `login/page.tsx` / `signup/page.tsx` — confirmed these already
    show a user-facing error message rather than an unhandled exception, so this behavior
    needed no changes.

### Supabase health-check script

- `npm run check:supabase --prefix backend` with no env vars — fails with a clear,
  single-line explanation and exit code 1.
- Same command with a fake (non-existent) Supabase URL and fake service key — connects,
  gets a network-level failure querying `public.user_profiles`, and reports it clearly
  (`Could not query public.user_profiles: TypeError: fetch failed. ...`) with exit code 1,
  rather than an unhandled rejection or stack trace.
- **Not tested**: a real fresh Supabase project with `backend/schema.sql` applied. This
  needs a real Supabase account, which this environment does not have. The script is
  designed to be run by whoever has that account — see `SUPABASE_SETUP.md` step 5 for the
  expected all-passing output.

### Lint

- `npm run lint --prefix frontend` (ESLint) — **144 pre-existing problems** (76 errors, 68
  warnings) across files this change did not touch (e.g. `useSelectedModel.ts`,
  `UserProfileContext.tsx`, `login/page.tsx`, `convert-courts-to-ts.js`). Confirmed by
  grepping the lint output for every file added or edited in this change
  (`frontend/src/config/**`, `frontend/src/app/layout.tsx`,
  `frontend/src/components/site-logo.tsx`, `frontend/src/app/signup/page.tsx`,
  `frontend/src/lib/supabase.ts`) — **none of them appear in the lint output**, i.e. this
  change introduces zero new lint issues. The pre-existing issues are out of scope for a
  setup/deployment-readiness pass and are left for a separate cleanup. Because `npm run
  verify --prefix frontend` chains `lint && typecheck && build`, it currently stops at the
  lint step for this pre-existing reason — `typecheck` and `build` were confirmed to pass
  independently (see above).

## What passed by inspection (not runnable in this environment)

- `backend/schema.sql` was not modified and was not re-run against a live Postgres/Supabase
  instance in this environment (no Docker, no Supabase account). It was read in full and is
  internally consistent (idempotent `create table if not exists` / `drop policy if exists`
  patterns, balanced `$$` function bodies, RLS enabled + policies defined for every table
  it creates). The new `check:supabase` script exists specifically so this can be verified
  against a real project by whoever has one.
- `frontend/vercel.json` and the Vercel deployment section of `README.md` were written
  based on documented Vercel behavior (framework auto-detection, Root Directory setting,
  environment variable scoping to Preview/Production) but an actual deployment to Vercel
  was not performed in this environment (no Vercel account access).
- `backend/nixpacks.toml` (pre-existing, unmodified) targets Nixpacks-based hosts
  (e.g. Railway); an actual deployment there was not performed either.

## Known unresolved / out of scope

See `SETUP_AUDIT.md` "Known gaps" for full detail. Summary:

- `frontend/src/app/support/page.tsx` posts to `/api/support`, which has no route handler
  anywhere in this repo — submitting the support form will 404. Not fixed (product
  decision, not a setup task).
- `backend/migrations/` is referenced by `README.md`/`backend/schema.sql` but does not
  exist. Doesn't block a fresh install; documented, not fabricated.
- 144 pre-existing ESLint issues unrelated to this change (see "Lint" above).
- `resend` is an unused dependency in both `package.json` files; `RESEND_API_KEY` is
  documented but nothing currently sends email through it. Left in place, flagged.
- `frontend/src/lib/storage.ts` and `frontend/src/lib/supabase-server.ts` are dead code
  (not imported anywhere in the frontend). Left in place to minimize diff size.

## Recommended next steps for the repo owner

1. Create a disposable Supabase project (`SUPABASE_SETUP.md`), fill in `backend/.env` and
   `frontend/.env.local` from the `.env.example` files, and run
   `npm run check:supabase --prefix backend` to confirm it reports all green.
2. Run `npm run dev --prefix backend` and `npm run dev --prefix frontend`, sign up a test
   user, create a project, upload a synthetic document (see
   `docs/safe-local-testing.md`), and confirm the assistant chat flow works end to end with
   a real model provider key.
3. Deploy `frontend/` to Vercel following `README.md` "Vercel deployment", pointing
   `NEXT_PUBLIC_API_BASE_URL` at a backend instance you host separately (Railway/Render/Fly/
   a VM — see `README.md` "Why the backend isn't on Vercel").
4. If you want an agent to perform steps 1–3 end-to-end (including real sign-up/chat
   testing against a live Supabase project and a real Vercel deployment), complete the
   onboarding flow at [cursor.com/onboard](https://cursor.com/onboard) so credentials can
   be provided as Cloud Agent secrets, then re-run this task.

# Setup Audit

This is a point-in-time audit of the repository as found, before any setup work in this
change. It exists so future contributors (including a future mode.law integration effort)
understand the starting architecture and the specific things that were blocking a fresh
Supabase + Vercel test deployment.

## 1. High-level architecture

Mike is **two independently deployable applications** in one repo, not a single Next.js
full-stack app:

```
frontend/   Next.js 16 (App Router) — UI only, talks to the backend over HTTP
backend/    Express API — Supabase access, LLM calls, document processing, storage
```

- **Package manager:** `npm`, with a per-app `package.json` and `package-lock.json`
  (`frontend/`, `backend/`). There is no root `package.json` and no workspace tool
  (no turborepo/pnpm-workspaces/nx). `bun.lock` files also exist in both apps, so some
  contributors use `bun`; `npm` is what the README documents and what this change
  standardizes on.
- **Frontend:** Next.js 16.0.3 (App Router), React 19, TypeScript, Tailwind v4. Uses
  `@supabase/supabase-js` **only for auth** (sign up / sign in / session token). All
  application data (`projects`, `documents`, `chats`, `workflows`, `tabular_reviews`, …)
  is fetched from the Express backend via `frontend/src/app/lib/mikeApi.ts`, which attaches
  the Supabase access token as a Bearer header. There are **no Next.js API routes**
  (`app/api/**/route.ts`) doing real work in this app — the one `fetch("/api/support", …)`
  call in `frontend/src/app/support/page.tsx` has no matching route handler in this repo
  and will 404 (see "Known gaps" below).
- **Backend:** Express 4 app (`backend/src/index.ts`) mounting routers for chat, projects,
  documents, tabular reviews, workflows, user settings, and signed downloads. Verifies the
  Supabase JWT on every protected route (`backend/src/middleware/auth.ts`) using the
  **service role key**, then uses the service role client for all reads/writes — RLS on
  the Postgres tables is defense-in-depth, not the primary access control (the anon/
  authenticated Postgres roles are explicitly revoked all table grants at the bottom of
  `backend/schema.sql`).
- **Database:** Supabase Postgres. Schema lives in `backend/schema.sql` (single file, ~1070
  lines) — tables, indexes, RLS policies, and helper functions for a **fresh** database.
  A `backend/migrations/` directory is referenced by the README but **does not exist** in
  this repo (dead reference — see "Known gaps").
- **Storage:** Not Supabase Storage. Object storage is S3-compatible via `@aws-sdk/client-s3`
  (`backend/src/lib/storage.ts`), documented for Cloudflare R2 but works with any
  S3-compatible endpoint (MinIO, etc.) by pointing `R2_ENDPOINT_URL` at it. This is already
  environment-driven and provider-agnostic in practice.
- **Auth:** Supabase Auth (email/password). The frontend talks to Supabase directly for
  sign-up/sign-in/session; the backend never issues its own sessions, it only verifies the
  Supabase-issued JWT per request. Stateless — no server-side session store — which is a
  good fit for Vercel's serverless model.
- **LLM providers:** Anthropic, Google Gemini, OpenAI — selected per request; keys can be
  set instance-wide (`backend/.env`) or per-user (encrypted in `public.user_api_keys`).
- **Document conversion:** `libreoffice-convert` shells out to a `soffice` binary for
  DOC/DOCX → PDF conversion. This needs a real LibreOffice install on the host — it will
  **not** run on Vercel's serverless functions or Cloudflare Workers. This only matters for
  wherever the *backend* is hosted, not for the Next.js frontend.

## 2. What already existed and is worth keeping as-is

- `backend/schema.sql` is a solid, fresh-database-ready schema: extensions, tables, indexes,
  a `handle_new_user` trigger that provisions `user_profiles` on signup, RLS policies on
  every table, and helper functions (`current_user_id_text`, `email_is_shared`,
  `project_is_accessible`, …) used by those policies. This is already good enough to be the
  basis of `SUPABASE_SETUP.md` with only additive documentation, not a rewrite.
- `docs/safe-local-testing.md` already gives solid operational guidance (disposable test
  resources, keeping secrets server-side, synthetic documents). Kept as-is and cross-linked.
- `.gitignore` at the repo root already excludes `.env`, `.env.*` (with explicit
  `!.env.example` / `!.env.local.example` exceptions), `.vercel`, build output, and logs.
  No changes were needed here.
- Storage access is already fully environment-driven (`R2_ENDPOINT_URL` / `R2_ACCESS_KEY_ID`
  / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME`), so swapping providers later (R2 → another
  S3-compatible provider, or a mode.law-hosted bucket) requires no code changes.

## 3. Blockers found for a fresh Vercel test deployment

These were reproduced locally and fixed as part of this change (see commits on this branch):

1. **`npm install` failed in `frontend/` out of the box.** `next` was pinned to `16.0.3`,
   but `@opennextjs/cloudflare` (a devDependency used only by the Cloudflare Pages/Workers
   deploy scripts, not by Vercel) requires `next >=16.2.6` for itself and its nested
   `@opennextjs/aws` dependency requires `~16.0.11 || ^16.1.5`. `16.0.3` satisfies neither,
   so `npm install` aborted with `ERESOLVE`. **Fix:** bumped `next` and `eslint-config-next`
   to `16.2.9` (latest stable in the 16.x line at audit time), which satisfies both ranges.
   Verified `next build` and `next dev` both work after the bump.
2. **`next build` crashed instead of failing gracefully when Supabase env vars are unset.**
   `frontend/src/lib/supabase.ts` called `createClient(url, key)` at module scope with empty
   strings when env vars were missing; `@supabase/supabase-js` throws synchronously
   (`"supabaseUrl is required."`), which aborted the *entire* production build the moment
   Next tried to prerender any page that imports the module — including pages that don't
   even need Supabase at build time (e.g. a client-only settings page). This meant a Vercel
   build would hard-fail if `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
   weren't set on the project yet, with only a stack trace and no guidance. **Fix:** the
   client now falls back to a syntactically valid placeholder when env vars are absent, and
   logs one clear warning during build/boot. Real auth calls with a placeholder URL fail
   with a normal Supabase error at request time, not a build-time crash.
3. **Backend had no startup-time env validation.** Missing `SUPABASE_URL` /
   `SUPABASE_SECRET_KEY` would previously only surface as per-request 401/500s with a
   generic message, discovered one route at a time. **Fix:** added
   `backend/src/lib/env.ts` + a `validateEnv()` call at the top of `backend/src/index.ts`
   that exits immediately with a clear, actionable message for missing required vars, and
   warns (without exiting) for recommended-but-optional vars (storage, download signing
   secret, at least one model provider key).
4. **A real (latent) bug:** `backend/src/routes/workflows.ts` built its own Supabase admin
   client using `process.env.NEXT_PUBLIC_SUPABASE_URL` instead of `process.env.SUPABASE_URL`.
   Since the backend's own `.env` (per the README and `.env.example`) only sets
   `SUPABASE_URL`, this client would silently receive an empty URL and every workflow-share
   admin-lookup path using it would fail. Fixed to use `SUPABASE_URL` with the `NEXT_PUBLIC_`
   variant kept only as a fallback for anyone sharing a single `.env` across both apps.
5. **No `vercel.json` / Vercel-specific configuration existed.** Not a hard blocker for a
   framework Vercel already auto-detects (Next.js App Router), but there was nothing
   documenting the required **Root Directory = `frontend`** project setting, and no
   `vercel.json` pinning the install/build commands so `npm install` (not `bun install`)
   runs in CI. Added a minimal `frontend/vercel.json` (see `API_BOUNDARY.md` /
   `README.md` Vercel section) and documented the project settings explicitly.
6. **The Express backend does not deploy to Vercel as-is.** It is a long-running Express
   process using `multer` (disk-backed uploads), `libreoffice-convert` (shells out to a
   `soffice` binary), and holds no per-request serverless constraints in mind. Rewriting it
   as Vercel Functions is a non-trivial, invasive change (large surface area — 8 routers,
   ~40 endpoints) and out of scope for "make it testable now." See the "Vercel + backend"
   decision in `README.md` for the chosen minimal path: **deploy the frontend to Vercel,
   run the backend anywhere that supports a long-lived Node process with LibreOffice
   installed** (Railway/Render/Fly/a VM — the existing `backend/nixpacks.toml` already
   targets Railway-style Nixpacks builds), and point `NEXT_PUBLIC_API_BASE_URL` at it.

## 4. Known gaps (documented, not silently fixed)

These were left alone because fixing them is either out of scope, would change product
behavior, or needs a decision this audit shouldn't make unilaterally:

- **`backend/migrations/` does not exist**, but the root `README.md` and `backend/schema.sql`
  header both reference it ("apply the incremental files in `backend/migrations/` instead").
  For a **fresh** Supabase project this doesn't matter (`schema.sql` is complete on its own),
  but the dangling reference is confusing. Documented in `SUPABASE_SETUP.md`.
- **`frontend/src/app/support/page.tsx`** posts to `/api/support`, which has no route
  handler anywhere in this repo (no `frontend/src/app/api/support/route.ts`, and the backend
  doesn't mount `/support` either). Submitting the support form will 404. This looks like
  a leftover from a removed feature (see git history: "remove app legal pages"). Left
  unfixed since implementing a support-ticket backend is a product decision, not a setup
  task — flagged here and in `TESTING.md`.
- **Unused/dead code:** `frontend/src/lib/storage.ts` and `frontend/src/lib/supabase-server.ts`
  duplicate backend logic but are not imported anywhere in the frontend (verified by
  grep). Likely leftover from an earlier architecture where the frontend ran its own
  server-side API routes (the `opennextjs-cloudflare` / `wrangler` scripts in
  `frontend/package.json` hint at a former or alternate Cloudflare Workers deployment
  model). Left in place to minimize diff size; safe to delete in a follow-up.
- **Unused dependency:** `resend` is listed as a dependency in both `frontend/package.json`
  and `backend/package.json`, and `RESEND_API_KEY` is documented in the README, but no
  source file in either app imports `resend`. Left in place (harmless, and removing
  dependencies is out of scope for a setup pass) but flagged for a future cleanup.
- **AGPL-3.0-only license, network-service triggering clause.** Both `frontend/package.json`
  and `backend/package.json` declare `"license": "AGPL-3.0-only"`, matching the repository
  `LICENSE` file. AGPL's key technical implication for the mode.law integration goal: if a
  proprietary mode.law system **modifies** this codebase and offers it as a network service
  to users, AGPL §13 requires offering the corresponding source of the modified version to
  those users. Running this repo **unmodified**, behind a documented HTTP API boundary
  (see `API_BOUNDARY.md`), and putting mode.law-specific logic in a *separate* proprietary
  codebase that merely calls that API, is the cleanest way to keep the proprietary system
  outside AGPL's reach. This is a technical observation only, not legal advice — get that
  from counsel before any commercial launch.

## 5. Scripts available after this change

| App      | Command                          | Purpose                                   |
|----------|-----------------------------------|--------------------------------------------|
| frontend | `npm run dev --prefix frontend`   | Local dev server (Turbopack, port 3000)   |
| frontend | `npm run build --prefix frontend` | Production build                          |
| frontend | `npm run start --prefix frontend` | Run the production build                  |
| frontend | `npm run lint --prefix frontend`  | ESLint                                    |
| frontend | `npm run typecheck --prefix frontend` | `tsc --noEmit` (added by this change) |
| frontend | `npm run verify --prefix frontend` | lint + typecheck + build (added)         |
| backend  | `npm run dev --prefix backend`    | `tsx watch` dev server (port 3001)         |
| backend  | `npm run build --prefix backend`  | `tsc` compile to `dist/`                   |
| backend  | `npm run start --prefix backend`  | Run the compiled build                     |
| backend  | `npm run typecheck --prefix backend` | `tsc --noEmit` (added by this change)  |
| backend  | `npm run lint --prefix backend`   | `tsc --noEmit` (no separate linter configured for the backend today — added as a baseline gate) |
| backend  | `npm run verify --prefix backend` | typecheck + build (added)                 |
| backend  | `npm run check:supabase --prefix backend` | Connects to Supabase and reports schema/config health (added by this change, see `SUPABASE_SETUP.md`) |

## 6. What this change does and does not touch

Does: fixes the two build/startup blockers above, adds env var documentation and
validation, adds a Supabase bootstrap path and health check, adds minimal Vercel
configuration, adds a `/config` layer for future branding/feature-flag/profile
customization, and documents the API boundary.

Does not: change any product behavior/UI, rewrite the Express backend, add mode.law
branding or business logic, or remove any existing dependency/file (dead code noted above
is left in place).

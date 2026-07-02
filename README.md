# Mike

Mike is a legal document assistant with a Next.js frontend, an Express backend, Supabase Auth/Postgres, and S3-compatible (Cloudflare R2 by default) object storage.

This fork is set up to be run and tested independently: a fresh Supabase project for data/auth, the frontend deployable to Vercel, and the backend deployable to any host that can run a long-lived Node process. See the docs below for the full picture — this README covers the fast path to running it locally.

## Contents

- `frontend/` - Next.js application (UI only; talks to the backend over HTTP)
- `backend/` - Express API, Supabase access, document processing, and database schema
- `backend/schema.sql` - Supabase schema for fresh databases
- `config/README.md` - the branding/feature-flag/deployment-profile configuration layer
- `docs/safe-local-testing.md` - operational guidance for testing with disposable resources
- `docs/integrations/` - design notes for planned (not yet built) integrations, e.g. a SharePoint/Zoho matter-sync adapter
- [`QUICKSTART.md`](./QUICKSTART.md) - one linear runbook: Supabase + Vercel + a backend host, start to finish, with exactly which key goes where
- [`SETUP_AUDIT.md`](./SETUP_AUDIT.md) - architecture audit and known gaps
- [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) - step-by-step fresh Supabase project setup
- [`API_BOUNDARY.md`](./API_BOUNDARY.md) - the HTTP API surface, for future external/integration callers
- [`TESTING.md`](./TESTING.md) - what has been verified in this environment and what remains unresolved

> **Note:** `backend/migrations/` is referenced by `backend/schema.sql`'s header for incremental updates to *existing* deployments, but does not currently exist in this repository. It does not affect fresh-project setup — see `SUPABASE_SETUP.md` and `SETUP_AUDIT.md` for details.

## Prerequisites

- Node.js 20 or newer
- npm (the standardized package manager for this repo — see `SETUP_AUDIT.md` if you see a `bun.lock` and wonder why)
- git
- A Supabase project (a free/disposable one is fine for testing — see `SUPABASE_SETUP.md`)
- An S3-compatible bucket: Cloudflare R2, MinIO, or another provider (optional for first boot — the app starts without it, uploads/downloads are just disabled)
- At least one supported model provider API key: Anthropic, Google Gemini, or OpenAI (optional for first boot — can also be added per-user in-app)
- LibreOffice installed locally if you need DOC/DOCX to PDF conversion (backend only)

## Quick start

For a full click-by-click walkthrough (create the Supabase project, deploy the backend, deploy the frontend to Vercel, and get every key into the right file), see [`QUICKSTART.md`](./QUICKSTART.md). Short version for local-only testing:

```bash
git clone <this-repo>
cd mike

# 1. Install
npm install --prefix backend
npm install --prefix frontend

# 2. Configure env vars
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
# edit both files — see "Environment" below

# 3. Set up a fresh Supabase project (see SUPABASE_SETUP.md), then verify it:
npm run check:supabase --prefix backend

# 4. Run both apps (two terminals)
npm run dev --prefix backend
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## Database Setup

See [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) for the full walkthrough (project creation, applying the schema, getting API keys, disabling email confirmation for local testing, and verifying the connection). Short version, for a new Supabase project: open the Supabase SQL editor and run the entire contents of `backend/schema.sql`.

For an existing database that already has Mike's schema applied, do **not** re-run the full schema file — see `SUPABASE_SETUP.md` "Existing databases".

## Environment

This repo has two independently deployable apps, each with its own env file — there is no single root `.env`. A root [`.env.example`](./.env.example) exists only as a pointer to the two real files:

- [`backend/.env.example`](./backend/.env.example) → copy to `backend/.env` (server secrets — Supabase service role key, storage credentials, model provider keys, signing secrets)
- [`frontend/.env.local.example`](./frontend/.env.local.example) → copy to `frontend/.env.local` (client-safe public config — Supabase URL/anon key, backend base URL)

Both example files are grouped and commented (Supabase / storage / LLM providers / app URLs / security secrets / deployment profile) and explain which variables are required locally vs. on Vercel. **Never commit `backend/.env` or `frontend/.env.local`** — both are already excluded by `.gitignore`.

Key points:

- Supabase values come from the project dashboard (**Project Settings > API**). Use the project URL for `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`, the service role key for `SUPABASE_SECRET_KEY`, and the anon/public key for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`. If your Supabase project shows multiple key formats, use the legacy JWT-style anon and service role keys expected by the Supabase client libraries.
- Only `NEXT_PUBLIC_`-prefixed variables are safe to put in the frontend — they are bundled into client-side JavaScript. Everything else (service role key, model provider keys, storage credentials) belongs in `backend/.env` only. See `docs/safe-local-testing.md` for more on this.
- Provider keys are only needed for the models you plan to use. Model provider keys can be configured in `backend/.env` for the whole instance, or per user in **Account > Models & API Keys**. If a provider key is present in `backend/.env`, that provider is available by default and the matching browser API key field is read-only.
- The backend fails fast at startup with a clear message if `SUPABASE_URL` / `SUPABASE_SECRET_KEY` are missing (see `backend/src/lib/env.ts`), and warns (without exiting) if storage or signing-secret variables are missing.
- All secrets are read only from `process.env` — nothing is hardcoded. See `SETUP_AUDIT.md` for confirmation of this across both apps.

## Install

Install each app package (npm is the standardized package manager for both apps — see `SETUP_AUDIT.md` for why the `frontend/bun.lock` present in this repo isn't the primary path):

```bash
npm install --prefix backend
npm install --prefix frontend
```

## Run Locally

Start the backend:

```bash
npm run dev --prefix backend
```

Start the main app:

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## First Run

1. Sign up in the app.
2. If you did not set provider keys in `backend/.env`, open **Account > Models & API Keys** and add an Anthropic, Gemini, or OpenAI API key.
3. Create or open a project and start chatting with documents.

## Vercel deployment (frontend)

The frontend is a standard Next.js App Router app and deploys to Vercel with no code changes beyond what's already in this repo. The Express backend does **not** run on Vercel — see "Why the backend isn't on Vercel" below.

1. **Import the repo into Vercel** and set **Root Directory to `frontend`** in the project's General settings. There is no root `package.json`, so Vercel must be pointed at the `frontend/` directory to detect the Next.js framework and run the build there.
2. Vercel auto-detects the Next.js framework. `frontend/vercel.json` in this repo pins the install/build/dev commands explicitly to `npm` (the frontend directory also has a `bun.lock`, which could otherwise make package-manager auto-detection ambiguous).
3. **Set environment variables** in the Vercel project (Settings > Environment Variables), one entry per variable from `frontend/.env.local.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
   - `SUPABASE_SECRET_KEY` (not required by any active frontend code path today, but harmless to set — see `SETUP_AUDIT.md`)
   - `NEXT_PUBLIC_API_BASE_URL` — the public URL of your deployed backend (see below)
   - Set these for both **Preview** and **Production** environments if you want preview deployments to work against a (disposable/test) Supabase project.
4. The build succeeds even if these env vars are missing (the Supabase client falls back to a safe placeholder at build time and logs a warning — see `SETUP_AUDIT.md` item 2), so a first deploy will build, but auth/API calls will fail at runtime until the env vars are set correctly. Set them before testing sign-up/sign-in.
5. Deploy. Preview deployments (per-PR/per-branch) and the Production deployment both work the same way — they just read different values for the env vars above depending on which Vercel environment they're configured for.

### Why the backend isn't on Vercel

The Express backend (`backend/`) is a long-running Node process, not a set of stateless request handlers, and depends on things that don't fit Vercel's serverless Functions model without a significant rewrite:

- `libreoffice-convert` shells out to a `soffice` binary for DOC/DOCX → PDF conversion — this needs a real LibreOffice install on the host, which Vercel Functions don't provide.
- `multer` is configured for in-memory/disk-backed multipart uploads across ~40 endpoints in 8 routers; converting all of this to Vercel's Function request/response model is a large, invasive rewrite, not a "make it testable now" change.
- The app is a single long-lived process with its own rate limiting (`express-rate-limit`) and CORS configuration — this maps naturally to a normal Node host, not to independently-invoked Functions.

**Chosen path for testing now (least invasive):** deploy the frontend to Vercel, and run the backend anywhere that supports a long-lived Node process with LibreOffice installed — Railway, Render, Fly.io, or a VM all work. `backend/nixpacks.toml` already configures a Nixpacks build that installs LibreOffice, which several of those platforms (e.g. Railway) use automatically. Point the frontend's `NEXT_PUBLIC_API_BASE_URL` at wherever you deploy the backend, and set the backend's `FRONTEND_URL` to your Vercel URL (for CORS).

If a fully Vercel-hosted stack becomes a hard requirement later, the least invasive path would be incrementally converting individual backend routers to Next.js Route Handlers (`frontend/src/app/api/**/route.ts`) that call the same `backend/src/lib/*` modules, replacing `multer` with Vercel's request body streaming and swapping LibreOffice conversion for a hosted conversion API. That is a real migration project, not a config change, and is out of scope here.

## Mode.law future-proofing

This repo includes a small, explicit configuration layer (`backend/src/config/`, `frontend/src/config/`, documented in `config/README.md`) for branding, default prompts, allowed document categories, feature flags, support contact, and external links — selected via a `DEPLOYMENT_PROFILE` (backend) / `NEXT_PUBLIC_DEPLOYMENT_PROFILE` (frontend) env var. Only an `oss` profile has real values today; a `mode-law` profile placeholder exists with the same generic values, ready for a future overlay to fill in without touching application code. See `config/README.md` for the full explanation, and `API_BOUNDARY.md` for the HTTP API surface a future proprietary system should call instead of importing this codebase directly (keeping the AGPL boundary clean — see `SETUP_AUDIT.md` "Known gaps" for the technical reasoning).

The first concrete future-integration under discussion — a SharePoint/Zoho matter-sync adapter for Attune Legal — is captured as a design-only planning doc in [`docs/integrations/sharepoint-zoho-matter-sync.md`](./docs/integrations/sharepoint-zoho-matter-sync.md). No code for it exists yet; the doc records the architecture decision (a separate adapter service calling this app's own API, not code inside this repo) before implementation starts.

## Troubleshooting

**Sign-up confirmation email never arrives.** Confirmation emails are sent by Supabase Auth, not by Mike. For local development, the simplest fix is to disable email confirmation in **Supabase > Authentication > Providers > Email**. For production, configure custom SMTP in Supabase; the built-in mailer is heavily rate-limited and may be restricted on newer projects.

**The model picker shows a missing-key warning.** Add a key for that provider in **Account > Models & API Keys**, or configure the provider key in `backend/.env` and restart the backend.

**DOC or DOCX conversion fails.** Install LibreOffice locally and restart the backend so document conversion commands are available on the process path.

**Backend exits immediately on startup.** It fails fast with a message listing exactly which required env vars are missing (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`). Copy `backend/.env.example` to `backend/.env` and fill those in.

**Not sure if Supabase is wired up correctly.** Run `npm run check:supabase --prefix backend` — it's a read-only script that reports exactly what's missing or misreachable. See `SUPABASE_SETUP.md`.

## Useful Checks

```bash
npm run verify --prefix backend    # typecheck + build
npm run verify --prefix frontend   # lint + typecheck + build
npm run check:supabase --prefix backend  # Supabase connectivity + schema health check
```

Individual scripts, if you want to run one at a time:

| App      | `dev` | `build` | `start` | `lint` | `typecheck` |
|----------|-------|---------|---------|--------|-------------|
| frontend | `next dev` | `next build` | `next start` | ESLint | `tsc --noEmit` |
| backend  | `tsx watch src/index.ts` | `tsc` | `node dist/index.js` | `tsc --noEmit` (no separate linter configured yet) | `tsc --noEmit` |

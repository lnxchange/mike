# Planned integration: SharePoint / Zoho matter sync

**Status: design notes only. No code for this exists in the repo yet.** This document
captures an architecture decision made before implementation starts, so the build follows
the intended shape from the first commit instead of being refactored into it later.

This is Attune Legal / mode.law-specific planning, not general OSS guidance — it lives
under `docs/integrations/` (rather than the root-level docs) to keep it clearly separated
from the docs that describe this repo's own generic setup. See `config/README.md` for why
that separation matters.

## The goal

From inside this app, open a matter and see its SharePoint documents without a manual
upload step:

1. The firm's matter management system is split across **Zoho** (matter/client metadata,
   practice management) and **SharePoint** (each matter has a dedicated document folder).
2. First time a matter is opened in this app, pull that folder's documents in.
3. Every time the matter is revisited, refresh so the app reflects whatever is currently in
   the SharePoint folder — without a full re-list/re-download every time.

## Why the existing data model already fits this

No schema redesign is needed to represent "a matter with synced documents" — `projects` is
already, functionally, a matter record (`API_BOUNDARY.md` calls it "Create workspace /
matter"), and it already carries an external-reference field:

```83:92:backend/schema.sql
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  cm_number text,
  visibility text not null default 'private',
  shared_with jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`cm_number` already plays the role "case/matter number that ties this row to an external
system" — the same slot a Zoho matter ID would occupy. Documents already have full version
history with a `source` tag distinguishing where each version came from:

```134:152:backend/schema.sql
create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  storage_path text not null,
  pdf_storage_path text,
  source text not null default 'upload',
  version_number integer,
  display_name text,
  created_at timestamptz not null default now(),
  constraint document_versions_source_check
    check (source = any (array[
      'upload'::text,
      'user_upload'::text,
      'assistant_edit'::text,
      'user_accept'::text,
      'user_reject'::text,
      'generated'::text
    ]))
);
```

Ingesting SharePoint files through this same table just needs one more `source` value
(e.g. `sharepoint_sync`) added to that check constraint, and storage itself needs no
change at all — synced files write to the same S3-compatible bucket via the same
`uploadFile`/`storageKey` helpers in `backend/src/lib/storage.ts` that manual uploads
already use (see "Storage and data safety" in `SETUP_AUDIT.md`).

## Architecture decision: a separate adapter service, not code inside this repo's backend

This is the one decision this document exists to record, because it's easy to get backwards
once implementation starts.

**Do not put SharePoint/Zoho sync code inside `backend/`.** Build it as a standalone
service (can live in a private repo) that talks to this app only through the existing HTTP
API documented in `API_BOUNDARY.md` — the same `POST /projects` and
`POST /projects/:projectId/documents` endpoints the browser frontend already uses,
authenticating as a normal Supabase user (or a dedicated service-account user).

Reasoning:

1. **Credential blast radius.** The Microsoft Graph app used for this will plausibly have
   broad SharePoint access (and Zoho access, if reusing an existing integration app —
   see "Auth and credentials" below). This repo's `backend/` is meant to stay a normal,
   self-hostable OSS service — the same property that lets anyone `git clone` it and run
   it with their own Supabase project (see `SETUP_AUDIT.md`, `SUPABASE_SETUP.md`). A
   credential that can read an entire SharePoint tenant does not belong inside a codebase
   with that property, even for an internal-only deployment.
2. **AGPL boundary stays clean.** `API_BOUNDARY.md`'s "Recommendation for a future mode.law
   integration" already establishes this pattern for any proprietary caller — this sync
   adapter is the first concrete instance of it, not a special case.
3. **No code changes to the OSS repo required to ship this.** The adapter is a client of
   this app's existing API, same as the frontend. The only in-repo change needed is the
   additive schema change described above (new `document_versions.source` value, and a
   new column on `projects` for the SharePoint folder reference).

If tighter in-process integration is ever genuinely required, the fallback is new
`backend/` routes gated behind the `modeLawIntegration` feature flag already scaffolded in
`backend/src/config/` (see `config/README.md`) — but start with the separate-adapter
approach; it's strictly less coupling for the same outcome.

## Auth and credentials

- **Reusing the existing Microsoft Graph app** (already consented for the Zoho↔SharePoint
  integration) is fine and saves the slow part of any Graph integration — Entra ID app
  registration and admin consent. A standalone app registration is also fine if preferred;
  neither choice changes the design above.
- Regardless of which app is used, prefer `Sites.Selected` application permission (with a
  per-site access grant) over a tenant-wide `Sites.Read.All`/`Sites.ReadWrite.All` scope,
  so the credential can only read the specific matter document libraries this integration
  actually needs — not the whole tenant. This is a Microsoft Graph best practice
  independent of the reuse-vs-new-app decision.
- These credentials (Graph tenant ID / client ID / client secret or certificate, and any
  Zoho OAuth credentials) live **only** in the separate adapter service's own environment
  — never in `backend/.env`, `frontend/.env.local`, or any file in this repository. This
  follows the same "secrets only from `process.env`, never hardcoded, never committed"
  rule already established for this repo's own secrets (`SETUP_AUDIT.md` §2,
  `.env.example` files).
- The adapter authenticates *to this app* as a normal Supabase user with a valid JWT
  (`API_BOUNDARY.md` "How auth works across the boundary") — it does not need any new
  auth mechanism on this app's side.

## Sync design

- **First open of a matter:** resolve the matter → SharePoint folder (via the new
  `projects` column below), list the folder via Microsoft Graph, download each file, and
  push it through this app's existing upload endpoint
  (`POST /projects/:projectId/documents`) — reusing all the existing document processing
  (page extraction, structure tree, etc.) with no changes needed there.
- **Revisit refresh:** use Microsoft Graph **delta queries**
  (`/sites/{site-id}/drive/root/delta` or equivalent for the specific folder) rather than
  re-listing and diffing the whole folder on every visit. Store the delta token per matter
  (a new column, or a small side table keyed by `project_id`) so each refresh only needs to
  ask "what changed since last time." This is a performance/cost decision, not a
  permissions one — it applies the same way regardless of which Graph app/credential is
  used.
- **Conflict policy — open question, resolve before building.** This app already lets
  documents be edited in-place (AI-driven edits, accept/reject — see the `assistant_edit`,
  `user_accept`, `user_reject` sources above). Once documents can also change independently
  in SharePoint, there needs to be an explicit rule for what happens when both sides
  changed the same file. Options to decide between before implementation starts:
  - SharePoint is always the source of truth; any in-app edits are exported back to
    SharePoint as a new version there, never silently overwritten by the next sync.
  - In-app edits create a fork (a new document, not synced back) and the SharePoint-synced
    copy stays read-only from this app's perspective.
  - Something in between, keyed off whether the in-app edit has been "accepted" yet.

## Open questions to resolve before implementation

1. **Zoho vs. SharePoint source of truth** — confirm which system owns which piece: is
   Zoho purely matter/client metadata with a pointer to a SharePoint folder, or does Zoho
   also need to be queried for anything document-related? This determines whether the
   adapter needs Zoho API access at all, or only Microsoft Graph.
2. **App-only vs. delegated Graph auth** — app-only (single service identity, works
   without per-user consent) is simpler to build; delegated (each user's own SharePoint
   permissions apply) is more correct if different people should see different matters
   through this app. Pick based on whether matter access here should mirror each
   individual's existing SharePoint permissions.
3. **Conflict policy** — see above; needs an explicit answer, not a default.
4. **Additive schema changes** — exact column name/shape for the SharePoint folder
   reference on `projects`, and the new `document_versions.source` value. Small, additive,
   and should ideally be captured as a numbered file once `backend/migrations/` exists
   again (see `SETUP_AUDIT.md` "Known gaps" — that directory is currently missing from
   this repo).

## How this maps back to the rest of the documentation

- `API_BOUNDARY.md` — this adapter is a concrete instance of "a future external system
  calling this API instead of importing this repo's code."
- `config/README.md` — the `modeLawIntegration` feature flag is reserved for exactly this
  kind of use case, in case a fallback to in-process integration is ever needed.
- `SETUP_AUDIT.md` — the missing `backend/migrations/` directory is relevant here: once
  this integration needs its first schema change, that's a natural point to reintroduce
  incremental migration files rather than hand-editing `backend/schema.sql`.

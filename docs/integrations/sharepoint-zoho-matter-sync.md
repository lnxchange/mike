# Planned integration: SharePoint / Zoho matter sync

**Status: design notes only. No code for this exists in the repo yet.** This document
captures an architecture decision made before implementation starts, so the build follows
the intended shape from the first commit instead of being refactored into it later.

**Current blocker (as of 2026-09-18): whether this plan is viable at all is now an open
question**, not just its implementation details — see "Coordination with the existing
Libris/Attune email-filer tool" below for a stated Microsoft-native-first / containment
concern from the adjacent Back Office codebase that may conflict with pulling matter
documents into Mike's stack. Needs a human decision before implementation starts.

This is Attune Legal / mode.law-specific planning, not general OSS guidance — it lives
under `docs/integrations/` (rather than the root-level docs) to keep it clearly separated
from the docs that describe this repo's own generic setup. See `config/README.md` for why
that separation matters.

## Deployment context (why this is a standalone deployment, not a mode.law feature yet)

There are three separate objectives in play for this codebase, in priority order as of
this writing:

1. **Evaluate the app** — general capability testing (largely covered by the local/
   Supabase-connected setup already done — see `TESTING.md`).
2. **Use it in Attune Legal's own practice**, connected to SharePoint/Zoho for matter
   documents — **this is the current priority** and what this document plans for.
3. **A separate, customer-facing mode.law instance** — for mode.law's own users to ask
   questions and edit generated/uploaded documents. This is a distinct, later effort.

Objective 2 is deliberately built as **its own standalone deployment** — its own Vercel
project, its own Railway-hosted backend, its own Supabase project (the one already
connected — see `SUPABASE_SETUP.md`), its own storage bucket. It is not folded into any
existing mode.law Vercel project or codebase. When objective 3 is eventually taken up, it
will be **another separate deployment** of this same repo (own Vercel project, own
Supabase project so mode.law's customer data never mixes with Attune Legal's matters),
using the `mode-law` profile in `config/README.md` for branding — not a merge of the two
into one instance. This keeps Attune Legal's matter data, and any SharePoint/Zoho
credentials, scoped to exactly one deployment that needs them.

**Libris** (Attune Legal's separate proprietary practice-management tool, with its own
Azure/Microsoft-model-hosted AI component) is a known adjacent system that already has its
own Azure Functions-based Graph/Zoho/SharePoint automation (the "Attune email-filer" /
Libris Back Office tool). This plan must be cross-checked against that codebase before
implementation to avoid duplicating or conflicting with work it already does — see
"Coordination with the existing Libris/Attune email-filer tool" below. No integration
*into* this app's own code is planned here; the concern is avoiding two independent,
possibly-conflicting implementations of the same matter/folder resolution and Graph/Zoho
access.

## The goal

From inside this app, open a matter and see its SharePoint documents without a manual
upload step — and have work done inside this app find its way back to SharePoint too:

1. The firm's matter management system is split across **Zoho** (matter/client metadata,
   practice management) and **SharePoint** (each matter has a dedicated document folder).
2. First time a matter is opened in this app, pull that folder's documents in.
3. Every time the matter is revisited, refresh so the app reflects whatever is currently in
   the SharePoint folder — without a full re-list/re-download every time.
4. **Two-way**: documents edited or generated inside this app should be reflected back into
   the SharePoint matter folder, not just pulled from it — see "Push direction" under
   "Sync design" below for the recommended (safety-first) design for this direction.

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

**Bucket choice for this deployment: Supabase Storage, not Cloudflare R2.** Supabase
Storage exposes its own S3-compatible endpoint
(`https://<project-ref>.storage.supabase.co/storage/v1/s3`, enabled and credentialed via
**Storage > Configuration > S3** in the dashboard) that supports every operation this
app's storage code uses (put/get/delete objects, presigned URLs). Since this deployment
already has a Supabase project connected, using its Storage instead of standing up a
separate Cloudflare account removes one more vendor/account from the setup — point the
existing `R2_ENDPOINT_URL` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME`
variables (names are legacy from when this repo only documented R2; the client is generic
S3) at the Supabase values instead. Revisit this choice only if document volume/egress
costs become a real concern later — R2's specific selling point is zero egress fees, which
Supabase Storage does not necessarily match.

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

- **Zoho API access is required, not optional.** Zoho is the confirmed source of truth for
  matter → SharePoint folder resolution (see "Sync design" below) — the adapter must query
  Zoho first, on every matter, to get the correct folder reference. It is not a
  document-content source; only the matter record + folder link are ever read from it.
- **Reusing the existing Microsoft Graph app** (already consented for the Zoho↔SharePoint
  integration) is fine and saves the slow part of any Graph integration — Entra ID app
  registration and admin consent. A standalone app registration is also fine if preferred;
  neither choice changes the design above.
- Regardless of which app is used, prefer `Sites.Selected` application permission (with a
  per-site access grant) over a tenant-wide `Sites.Read.All`/`Sites.ReadWrite.All` scope,
  so the credential can only read the specific matter document libraries this integration
  actually needs — not the whole tenant. This is a Microsoft Graph best practice
  independent of the reuse-vs-new-app decision. For the push direction (see "Sync design"),
  the granted scope needs to be `Sites.Selected` with **write**, not just read.
- These credentials (Graph tenant ID / client ID / client secret or certificate, and the
  Zoho OAuth credentials) live **only** in the separate adapter service's own environment
  — never in `backend/.env`, `frontend/.env.local`, or any file in this repository. This
  follows the same "secrets only from `process.env`, never hardcoded, never committed"
  rule already established for this repo's own secrets (`SETUP_AUDIT.md` §2,
  `.env.example` files).
- The adapter authenticates *to this app* as a normal Supabase user with a valid JWT
  (`API_BOUNDARY.md` "How auth works across the boundary") — it does not need any new
  auth mechanism on this app's side.

## Sync design

- **Source of truth — confirmed.** Zoho holds the matter number and the authoritative link
  to that matter's SharePoint folder. Folder resolution is **always** a Zoho lookup by
  matter number (matching this app's existing `cm_number` field), never a SharePoint-side
  search/guess. This is deterministic and reliable specifically because Zoho already
  maintains that mapping — the adapter should not attempt to independently locate a
  matter's folder by any other means (e.g. name matching against SharePoint's folder
  structure).
- **First open of a matter:** query Zoho by matter number to resolve the SharePoint folder
  reference, store that reference on the new `projects` column (see "Open questions"
  below), list the folder via Microsoft Graph, download each file, and push it through
  this app's existing upload endpoint (`POST /projects/:projectId/documents`) — reusing
  all the existing document processing (page extraction, structure tree, etc.) with no
  changes needed there.
- **Revisit refresh:** use Microsoft Graph **delta queries**
  (`/sites/{site-id}/drive/root/delta` or equivalent for the specific folder) rather than
  re-listing and diffing the whole folder on every visit. Store the delta token per matter
  (a new column, or a small side table keyed by `project_id`) so each refresh only needs to
  ask "what changed since last time." This is a performance/cost decision, not a
  permissions one — it applies the same way regardless of which Graph app/credential is
  used.
- **Push direction (MikeOS → SharePoint) — design confirmed.** The goal is genuine two-way
  sync: edits/generated documents made in this app should be reflected back in the
  SharePoint matter folder, not just pulled from it.
  Graph API supports uploading a new version of an existing SharePoint file (SharePoint
  keeps its own version history, so no version is ever destroyed by a push), which makes
  the mechanics straightforward. The risk worth designing around deliberately is **silent
  overwrite of a concurrent edit** — e.g. someone reformats the file directly in
  SharePoint/Word at the same time the AI edits it in MikeOS, and whichever sync runs last
  wins with no one told there was a conflict. Recommended design, to avoid that:
  - **Pull stays automatic** (as described above) — it's read-only from SharePoint's side,
    so there's nothing to lose by refreshing silently.
  - **Push is an explicit, user-triggered action** (e.g. a "Save to SharePoint" step after
    a user accepts an AI edit — reusing the existing `user_accept` moment in the edit
    workflow), not a continuous background sync in that direction.
  - **Push is guarded by an ETag/ctag check**: before uploading, confirm the SharePoint
    item hasn't changed since MikeOS last synced it. If it has, block the push and surface
    the conflict to the user instead of overwriting.
  - Treat "should push ever become fully automatic" as a decision to revisit after the
    explicit-confirmation version has been used for a while, not a starting point — for a
    legal-document system, an unnoticed overwrite is a worse failure mode than an extra
    confirmation click.

## Decisions confirmed

1. **Zoho is the source of truth** for matter → SharePoint folder resolution. The adapter
   queries Zoho by matter number to get the folder reference; it never searches or infers
   the folder from SharePoint directly. Zoho API access is therefore required (see "Auth
   and credentials"). Zoho is not queried for document content, only the matter/folder
   link.
2. **Push-direction design signed off**: explicit user-triggered push, guarded by an
   ETag/ctag conflict check, not continuous automatic bidirectional sync (see "Sync
   design" above for the full rationale).

## Open questions to resolve before implementation

1. **App-only vs. delegated Graph auth** — app-only (single service identity, works
   without per-user consent) is simpler to build; delegated (each user's own SharePoint
   permissions apply) is more correct if different people should see different matters
   through this app. Pick based on whether matter access here should mirror each
   individual's existing SharePoint permissions.
2. **Additive schema changes** — exact column name/shape for the SharePoint folder
   reference on `projects` (populated from the Zoho lookup above), and the new
   `document_versions.source` value. Small, additive, and should ideally be captured as a
   numbered file once `backend/migrations/` exists again (see `SETUP_AUDIT.md` "Known
   gaps" — that directory is currently missing from this repo).
3. **Coordination with the existing Libris/Attune email-filer tool** — see the dedicated
   section below. Blocked on getting this doc's author (or a future agent) read access to
   that codebase.

## Coordination with the existing Libris/Attune email-filer tool

There is already a live Azure Functions codebase (referred to as "Libris Back Office" /
the Attune email/SharePoint filer — Graph, Zoho, and a command queue) that does related
work today. **This design has not yet been directly cross-checked against that
codebase** — the codebase itself has not been read by whoever/whatever is authoring this
doc. The notes below were relayed secondhand (via chat, from a separate agent session
operating directly on that codebase) and should be treated as a starting point for
verification, not a confirmed fact, until read directly.

### Relayed finding: a stated conflict this plan needs to resolve — the most important open item

An agent working directly in the Back Office/filer codebase gave this assessment when
asked about integrating with Mike (paraphrased from the relayed note, dated 2026-09-18):

- If Mike stays a separate running product, the filer's intended hook for *itself* to call
  *into* Mike is **inbound MCP** (`SPEC-mcp-connections.md`, `src/mcp_connections.py`, a
  planned `mcp.call` operation — specified but not built; registrations currently
  `active: False`). Until that ships, their recommendation is a thin `admin_chat` read
  tool as the lower-friction way to query Mike, rather than a new queue op or Function
  route.
- If the actual goal is "Mike-class AI document work" (chat-with-documents, redlining)
  living *inside* Back Office rather than in a separate app, their recommendation is native
  `doc.*` work (`doc.redline`, `doc.comment`, `find_in_document`) instead of wrapping Mike
  as a callable tool — because wrapping Mike would route matter documents through "a
  Node / Supabase / R2 / Anthropic stack," which they say conflicts with two stated
  principles: **Microsoft-native-first** and an **executor-hosted containment rule**.

**Why this matters here:** the direction above ("Back Office calls into Mike for a
read-only chat/Q&A") is compatible with what this repo already exposes —
`API_BOUNDARY.md`'s `POST /chat` primitive is essentially the `admin_chat` tool they
describe, authenticated as a Supabase user like any other caller. **No conflict there.**

The unresolved conflict is with the *other* direction this whole document plans for:
pulling matter documents out of SharePoint and into Mike's stack (Supabase, an
S3-compatible bucket, an LLM provider) so Mike's AI can work on them — which is exactly
the "Node/Supabase/R2/Anthropic stack" the relayed note says conflicts with
Microsoft-native-first / containment. Whether that's actually a blocker depends on scope,
which is not yet known:

- **(a)** The containment rule could be scoped specifically to Back Office's own
  *automated* filer/executor pipeline — in which case a lawyer choosing to open a
  separate, sibling app (Mike) for interactive, opt-in document work is a different flow
  the rule was never meant to cover, and this plan can proceed largely as designed.
- **(b)** The containment rule could be a blanket constraint that matter documents must
  never leave Microsoft-hosted infrastructure at all — in which case the SharePoint →
  Mike sync plan as designed (not just its auth/schema details) needs to be reconsidered,
  not merely refined.

**This must be resolved by a human decision-maker (not inferred or assumed by an agent on
either side) before any implementation work on the push/pull sync begins.** The `admin_chat`
/ `POST /chat` direction can likely proceed regardless of how (a)/(b) resolves.

### Other cross-checks still needed once direct read access exists

- Does that tool already maintain a matter-number → SharePoint-folder lookup (via Zoho or
  otherwise)? If so, this adapter should call/reuse that resolution rather than
  re-implementing it independently — two independent implementations of the same lookup
  is exactly the kind of duplication this cross-check is meant to prevent.
- Does that tool already hold a Microsoft Graph app registration and/or Zoho OAuth
  credentials this adapter could reuse (see "Auth and credentials" — reuse vs. new app was
  already flagged as an open, low-risk choice; whether *this specific* existing tool's app
  is the right one to reuse is now the more precise question).
- Does that tool use a command-queue pattern (mentioned when this integration was
  scoped) that this sync adapter should plug into, rather than polling/webhooks designed
  independently here.

As of this writing, the codebase for that tool has not been reviewed directly as part of
this plan — access to it was requested but not yet established (a local-only path was
given; see the repository's contribution history for the access-mechanics discussion). Do
not finalize the schema/auth decisions above as "ready to build" until both the
Microsoft-native-first/containment question and this cross-check have actually happened.

## How this maps back to the rest of the documentation

- `API_BOUNDARY.md` — this adapter is a concrete instance of "a future external system
  calling this API instead of importing this repo's code."
- `config/README.md` — the `modeLawIntegration` feature flag is reserved for exactly this
  kind of use case, in case a fallback to in-process integration is ever needed.
- `SETUP_AUDIT.md` — the missing `backend/migrations/` directory is relevant here: once
  this integration needs its first schema change, that's a natural point to reintroduce
  incremental migration files rather than hand-editing `backend/schema.sql`.

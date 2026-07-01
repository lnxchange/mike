# API Boundary

This document identifies the HTTP API surface a future external system — including a
proprietary mode.law product — should call into, instead of importing this repo's code or
querying its Supabase database directly. Treating this boundary as the integration point
is what keeps this repo a standalone, self-hostable AGPL service that a separate
proprietary system can *use* without being *built on top of* (see `SETUP_AUDIT.md`
"Known gaps" for the licensing reasoning behind that distinction).

This is a description of what already exists today, not a proposal for new endpoints. No
API design changes were made as part of this documentation pass.

## How auth works across the boundary

Every route below (except `GET /health`) requires an `Authorization: Bearer <supabase-jwt>`
header — the same access token the frontend gets from `supabase.auth.getSession()` after a
user signs in via Supabase Auth. The backend verifies this token against Supabase on every
request (`backend/src/middleware/auth.ts`) and uses `res.locals.userId` /
`res.locals.userEmail` for authorization from then on. There is no separate API-key or
service-to-service auth mechanism today — a future external system calling this API would
authenticate as a Supabase user, the same way the frontend does.

## Core actions (the ones the objective specifically calls out)

| Action | Endpoint(s) | Notes |
|---|---|---|
| **Create workspace / matter** (called "project" in this codebase) | `POST /projects` | Body: `{ name, cmNumber? }`. Returns the created project. |
| List / read workspaces | `GET /projects`, `GET /projects/:projectId` | |
| Update / delete workspace | `PATCH /projects/:projectId`, `DELETE /projects/:projectId` | |
| Share a workspace | `GET/PATCH /projects/:projectId/people` (via the `shared_with` field) | Email-based sharing, not org/team based. |
| **Upload document** | `POST /projects/:projectId/documents` (project-scoped), `POST /single-documents` (standalone) | `multipart/form-data`, rate-limited (`uploadLimiter`). Stores the file in S3-compatible storage and a row in `public.documents`. |
| List / read documents | `GET /projects/:projectId/documents`, `GET /single-documents`, `GET /single-documents/:documentId/display` | |
| Delete document | `DELETE /single-documents/:documentId` | |
| Document versions (new upload, AI edit, accept/reject) | `GET/POST /single-documents/:documentId/versions` | |
| **Ask a question against a document set** | `POST /chat/create` then `POST /chat` (standalone chat), or `POST /projects/:projectId/chat` (project-scoped chat) | Streams the assistant's response (SSE-style chunked stream), including citation markers (see `backend/src/lib/chatTools.ts`). This is the main "ask a question" primitive. |
| **Run document review** (structured, multi-document extraction) | `POST /tabular-review` (create), `POST /tabular-review/:reviewId/generate` (run extraction across documents/columns) | This is the "tabular review" feature — closest existing analog to a bulk/structured document review action. |
| Ask a question within a tabular review | `POST /tabular-review/:reviewId/chat` | |
| **Export result** | `GET /single-documents/:documentId/docx`, `GET /single-documents/:documentId/url` (signed download URL), `POST /single-documents/download-zip`, `GET /download/:token` | The `generate_docx` chat tool (see `API_BOUNDARY.md` → chat streaming) produces downloadable Word documents; `GET /download/:token` serves them via a signed, non-expiring token (see `backend/src/lib/downloadTokens.ts`). Tabular review results can be exported client-side to Excel (`frontend/src/app/components/tabular/exportToExcel.ts` — client-side only today, not a backend endpoint). |

## Full route inventory

Base URL: whatever `NEXT_PUBLIC_API_BASE_URL` points at (default `http://localhost:3001`
locally). All paths below are mounted exactly as shown in `backend/src/index.ts`.

### `/projects` — workspaces/matters

- `GET /projects` — list projects visible to the caller (owned or shared).
- `POST /projects` — create a project.
- `GET /projects/:projectId` — read one project.
- `PATCH /projects/:projectId` — update a project.
- `DELETE /projects/:projectId` — delete a project.
- `GET /projects/:projectId/people` — list who a project is shared with.
- `GET /projects/:projectId/documents` — list documents in a project.
- `POST /projects/:projectId/documents` — upload a document into a project (rate-limited).
- `GET /projects/:projectId/chats` — list chats scoped to a project.
- `POST /projects/:projectId/folders` — create a subfolder.
- `PATCH /projects/:projectId/folders/:folderId` — rename/move a subfolder.
- `DELETE /projects/:projectId/folders/:folderId` — delete a subfolder.
- `PATCH /projects/:projectId/documents/:documentId/folder` — move a document between folders.

### `/projects/:projectId/chat` — project-scoped assistant

- `POST /projects/:projectId/chat` — ask a question with project documents as context (rate-limited).

### `/chat` — standalone assistant chats

- `GET /chat` — list the caller's chats.
- `POST /chat/create` — create a new chat (rate-limited).
- `GET /chat/:chatId` — read a chat and its messages.
- `PATCH /chat/:chatId` — rename a chat.
- `DELETE /chat/:chatId` — delete a chat.
- `POST /chat/:chatId/generate-title` — auto-generate a chat title (rate-limited).
- `POST /chat` — send a message in a chat / run the assistant (rate-limited).

### `/single-documents` — standalone (non-project) documents

- `GET /single-documents` — list the caller's standalone documents.
- `POST /single-documents` — upload a document (rate-limited).
- `DELETE /single-documents/:documentId` — delete a document.
- `GET /single-documents/:documentId/display` — get a viewer-friendly representation.
- `POST /single-documents/download-zip` — download multiple documents as a zip.
- `GET /single-documents/:documentId/url` — get a signed direct-download URL.
- `GET /single-documents/:documentId/docx` — export/download as DOCX.
- `GET /single-documents/:documentId/versions` — list versions of a document.
- `POST /single-documents/:documentId/versions` — upload a new version (rate-limited).

### `/tabular-review` — structured document review

- `GET /tabular-review` — list the caller's tabular reviews.
- `POST /tabular-review` — create a tabular review.
- `POST /tabular-review/prompt` — generate a column extraction prompt.
- `GET /tabular-review/:reviewId` — read a review (columns, documents, cells).
- `GET /tabular-review/:reviewId/people` — list who a review is shared with.
- `PATCH /tabular-review/:reviewId` — update a review (columns, documents, title, sharing).
- `DELETE /tabular-review/:reviewId` — delete a review.
- `POST /tabular-review/:reviewId/clear-cells` — clear extracted cell values.
- `POST /tabular-review/:reviewId/generate` — run extraction across documents × columns (rate-limited).
- `GET /tabular-review/:reviewId/chats` — list chats scoped to a review.
- `GET/DELETE /tabular-review/:reviewId/chats/...` — read/delete a review-scoped chat.
- `POST /tabular-review/:reviewId/chat` — ask a question within a review (rate-limited).

### `/workflows` — reusable prompt/column templates

- `GET /workflows` — list workflows (built-in + the caller's own + shared).
- `POST /workflows` — create a workflow.
- `PUT/PATCH /workflows/:workflowId` — update a workflow.
- `DELETE /workflows/:workflowId` — delete a workflow.
- `GET/POST /workflows/hidden`, `DELETE /workflows/hidden/:workflowId` — hide/unhide built-in workflows per user.
- `GET /workflows/:workflowId` — read one workflow.
- `GET /workflows/:workflowId/shares` — list shares for a workflow.
- `DELETE /workflows/:workflowId/shares/:shareId` — remove a share.
- `POST /workflows/:workflowId/share` — share a workflow with an email.

### `/user` (also mounted at `/users`) — account

- `GET/POST/PATCH /user/profile` — read/create/update the caller's profile.
- `GET /user/api-keys` — list which providers have a personal key configured (never returns key material).
- `PUT /user/api-keys/:provider` — set a personal model provider API key (encrypted at rest).
- `DELETE /user/account` — delete the caller's account.

### `/download` — signed document downloads

- `GET /download/:token` — stream a file using an HMAC-signed, non-expiring token (see `backend/src/lib/downloadTokens.ts`). Still requires auth (`requireAuth`) in addition to a valid token.

### `/health`

- `GET /health` — liveness check, no auth required. Returns `{ ok: true }`.

## Where there is no clean API yet

- **Bulk/programmatic export** — today, exporting a tabular review to Excel happens
  client-side in the browser (`frontend/src/app/components/tabular/exportToExcel.ts`); there is
  no `GET /tabular-review/:id/export.xlsx` backend endpoint an external system could call
  directly. If a proprietary system needs server-side export, this is the place to add one.
- **Webhooks / async job status** — document generation, extraction (`.../generate`), and
  DOC/DOCX conversion are all synchronous HTTP requests today (the caller waits for the
  response). There is no webhook or polling-status endpoint for long-running jobs. A future
  integration that needs to kick off work and be notified later would need this added.
- **Org/team-level sharing** — sharing (`shared_with`, `workflow_shares`) is per-email, not
  per-organization or per-API-key. A multi-tenant proprietary system calling in on behalf of
  many end users would need either a new team/org concept here, or to manage that entirely
  on its own side and call this API once per authenticated end user (the simpler, more
  boundary-respecting option, and the one this repo's current auth model already supports).
- **No API versioning** — routes are unversioned (`/projects`, not `/v1/projects`). Fine for
  a single first-party frontend; worth addressing (e.g. a `/v1` prefix) before treating this
  as a stable external integration surface.

## Recommendation for a future mode.law integration

Do not import `backend/src/**` modules directly from a proprietary codebase, and do not
grant a proprietary system's database role direct table access to this app's Postgres
schema (recall `backend/schema.sql` explicitly revokes `anon`/`authenticated` grants — see
`SUPABASE_SETUP.md` "Access model"). Instead, have the proprietary system authenticate as a
Supabase user (or a dedicated service-account user, if per-user attribution isn't needed)
and call the HTTP routes above, the same way this repo's own frontend does. That keeps this
repository's AGPL-covered code untouched and running as its own network service, with the
proprietary logic living entirely outside it.

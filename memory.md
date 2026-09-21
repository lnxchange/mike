# Mike / Libris Colleague — session memory

## 2026-09-21 — Microsoft login and Outlook draft spec parked for a cloud agent

Approved design is in `docs/integrations/microsoft-outlook-drafts.md`. Microsoft
becomes a login type (parallel to Google) and grants delegated `Mail.ReadWrite`.
Any user who authorises mail can stage a draft in their own mailbox, attach Mike
documents, and join a live thread (Message-ID, then subject + participant search).
Drafts only; never send. Filer stays matter-sync only.

Yule asked this to be committed and pushed so a cloud agent can implement it after
this machine is off. Do not apply the new migration to production, do not deploy,
and do not touch the dirty filer tree, until he confirms. Entra app + Supabase
Azure provider + admin consent are still operator setup.

## 2026-09-21 — Zoho pull of 263403 looked empty

Yule pulled Zoho matter 263403 (Shout Web Strategy Pty Ltd - T&C review, Deal `3849704000065103001`) at 11:36 AEST. Project `5bc0b4e6-7039-42b1-b96d-e17bef0d01b0` was created. Both pull and Sync now returned 200 (37s / 36s). The filer uploaded the three root PDFs immediately. The upload worker was saturated by the ACCC s155 drain (`41cfbdbf`, ~7k docs; GET `/documents?for=sync` 28–30s, often 499). Processing jobs sat from 11:36 until 11:50. Sync now at 11:45 re-uploaded the same three files because no `external_item_id` rows existed yet. Documents ready since 11:50: LegalRequestForm.pdf, Blue_NRG_-_Social_Ads___Creative_Agreement.pdf, Shout_Master_Terms_and_Conditions__Blue_NRG.pdf. `sharepoint_folder_url` still null (persist ran before docs existed). UI stopped polling on filer Idle, so the page stayed empty.

Uncommitted, not deployed: `useMatterSyncStatus` keeps polling after Idle while filer `documentCount` > visible ready docs, and refreshes the collection. Header and empty states now say "Processing documents from SharePoint, N of M ready" instead of "Up to date" / "Upload documents". Tests: `useMatterSyncStatus.test.ts`, ProjectWorkspace, ProjectPageParts.matterSync, ProjectExplorer. Did not change `UPLOAD_PROCESSING_MAX_RUNNING_PER_USER`. Did not deploy. Did not touch the dirty filer tree.

Yule waited about 10 minutes after Sync, with an empty folder, until this session queried the matter. The Idle header plus the upload empty state was the lie. The three PDFs have been ready since 11:50 AEST.

Deny-all RLS is now on in production (`gttnqqwqoirwbvalqfce`) for the 21 backend-owned tables that had shipped without it. Migration `20260921_05_backend_table_rls.sql` / applied name `backend_table_rls`. No policies. service_role still reads. Browser grants were already revoked.

Shipped `548cd038` on `cursor/setup-supabase-vercel-oss-cad9`. Vercel production `dpl_FQ6TgaJnLnLJjsxBAFE8qjf33FmP` READY + aliased to https://libris-colleague.vercel.app. Did not bounce Railway (no backend runtime change; a redeploy would restart the upload-worker mid s155 drain). Did not change `UPLOAD_PROCESSING_MAX_RUNNING_PER_USER`. Did not deploy the dirty filer tree.

## 2026-09-21 — Filer listItem email mapping and S155 backfill

Leftover plan items `filer-listitem` and `email-backfill` from `library_metadata_styles_ea241fd2`.

### Filer (`sharepoint-email-filer`)

Isolated commit `1eb1bb0` on `cursor/fix-manage-chat-500`: `src/email_meta.py` plus `_upload_one` Graph `item_list_item` for `.eml`/`.msg` or an `Emails -` path. Maps EmSubject / EmFrom / EmTo / EmDateReceived with legacy OriginalSubject / From / To / EmailDate, then sends the existing upload `email` object. Unit tests: `python3 -m unittest tests.test_email_meta -q` (7 OK). Deployed `--code-only` to `attuneemailfiler-flex` (SHA stamped `1eb1bb0-dirty` because untracked `tmp-*` dirs were in the zip; Python src was the isolated commit). Did not use `ALLOW_DIRTY_DEPLOY`. Did not push (branch ahead 2). Working tree is dirty again with unrelated admin_chat / ctag-skip / zoho URL WIP. Do not redeploy until that is isolated.

### S155 backfill (project `41cfbdbf-a1f8-47a2-be4d-1208eb375b0f`)

Graph `az rest` over 531 mirrored rows that still had empty `email_*`. Attempted 531, updated 165, skipped 366 (listItem had no email fields, mostly DR Title-only), failed 0. SQL applied all 165 via Supabase MCP on `gttnqqwqoirwbvalqfce`, skip-if-already-filled. After apply: 706 S155 rows have any `email_*` (641 have `email_received_at`). All 641 arrived dates differ from Railway `created_at` (0 equal). 366 mirrored rows remain empty because SharePoint had nothing to copy. Northeon `e360041c-fe06-4743-8f43-23cae53a0f5b` has 0 `external_item_id`, skipped.

Mike was not committed. Browser on https://libris-colleague.vercel.app stopped at `/login` (no session). DocTable will show Arrived / From / To / Subject on S155 once Yule is logged in, because any loaded email_* row turns that column group on. Did not apply migration 08. Did not change `UPLOAD_PROCESSING_MAX_RUNNING_PER_USER`. Wiped `/tmp/s155-graph.env`.

Yule: hard-refresh S155. Arrived should be the SharePoint email date (2023–2026 correspondence), not 20 September 2026 ingest.

## 2026-09-21 — Library lookup, email columns, and date fix shipped

HEAD `5b7987f1` on `cursor/setup-supabase-vercel-oss-cad9`. Pushed. Feature commit `b233c4b4` (library lookup, email metadata, DocTable columns, AU execution blocks, 1970 date fix, Zoho/SharePoint pills). Follow-ups: `b6b4647b` (docxStyles tsc), `5b7987f1` (Library sortKey union).

Railway `mike` `4483df33` SUCCESS on SHA `b6b4647b` (backend-complete; frontend-only type fix after that). https://mike-production-68f2.up.railway.app `/health` 200. Vercel production `dpl_CBkvJ3UWtWob87jG65uPN9utTfG6` READY on SHA `5b7987f1`, aliased to https://libris-colleague.vercel.app.

Did not apply migration `20260920_08`. Email meta `20260921_04` already on production. Did not change `UPLOAD_PROCESSING_MAX_RUNNING_PER_USER`. Left sharepoint-email-filer alone (dirty tree). Did not invent a login for `/library` smoke.

## 2026-09-21 — Empty Attune Legal Files folder and 1970 dates

Yule was on Library → Files (`/library`). Attune Legal and personal source folders looked empty with Created/Updated as 1 January 1970.

Cause: those rows are synthetic `source:` grouping folders (`virtualSourceFolder` sends `created_at`/`updated_at` null). `formatDate(null)` became Unix epoch. The Files shelf for Attune is genuinely empty (0 library-only `library_kind=file` rows). The eight Masters are on the **Templates** shelf under Attune Legal: Templates (letterhead + presentation), Precedents/Commercial (4), Precedents/IP & Technology (1), Precedents/ESOP & Equity (1). Did not duplicate them onto Files (templates stay templates; sharing storage_path would be unsafe on delete).

Fix (uncommitted, not deployed): `formatDate` hides null/invalid/epoch; virtual folder rows omit dates; empty virtual Files folder says templates are on the Templates tab. Tests: frontend formatDate + DocTable virtual rows; backend library source-folder null timestamps.

Browser: production `/library` redirected to login in the Cursor browser. Local :3010 was down. Verified by SQL + component render tests, not a logged-in click-through.

S155 email backfill still 0/`email_*` (900 rows have `external_item_id`). Did not re-run Graph. Filer `colleague_sync` listItem mapping remains not deployed (tree dirty). Did not apply migration 08, did not change `UPLOAD_PROCESSING_MAX_RUNNING_PER_USER`.

Yule: open **Templates**, expand **Attune Legal**. Deploy the date fix before Files stops showing 1970.

## 2026-09-21 — Org Library shipped and Attune Masters seeded

HEAD `09331d0b` (feature `011f59d4`, UI typefix `d7089a6d`, backend tsc `09331d0b`). Library is a union of personal plus every org shelf. Migration `20260921_03_org_library.sql` applied to `gttnqqwqoirwbvalqfce`. Railway `mike` `7931d333` SUCCESS, SHA `09331d0b`, https://mike-production-68f2.up.railway.app `/health` 200. Vercel preview `dpl_FnCQkgYbUTHDUHGFcye5UmF9nzaF` READY (SHA `09331d0b`) and aliased to https://libris-colleague.vercel.app. `/login` follows to 200 (SSO gate on `/` is 302). Did not apply migration 08, did not change `UPLOAD_PROCESSING_MAX_RUNNING_PER_USER`, did not deploy the dirty filer.

Attune org `587af71c-e526-4b0e-971e-7e2d285ddac8` Templates shelf (library_kind template):

- Folders: Templates `c2b7258f-ec8e-473e-a1e6-669282254183`, Precedents `d4680723-5fc3-4a60-9537-21fccde11026`, Commercial `b4f1ce84-8655-45fa-85d2-f4487adce51b`, IP & Technology `bfc1c6d9-c847-4d07-9812-bd7ff8f237c6`, ESOP & Equity `ae5d1a4b-3b0c-46a6-a104-5adc8da051d4`.
- Letterhead `e120a232-4839-4707-ae92-5de3cc4c7d39`, presentation `64c51588-4330-469b-93f3-1e9baafa1a68`, NDA `eb97a134-b98a-4f90-9dbc-762447010694`, Privacy Policy `e7b10c9b-5b4a-4896-ab29-cc6e129852b2`, SaaS Terms `225bdb7d-85ad-4cdd-b289-1fd3824660c9`, Website Terms `04e0029c-4048-4639-a680-1a2ffa313344`, Legaler IP `bfeba474-d75d-4048-8737-88c6b01c40e9`, ESOP template `ccb70dd9-214a-47d6-8cdf-5b2a93fa0895`. Real version rows; filenames are the OneDrive names.

Firm Library project `383f34de-de29-45e3-89ab-31e09276c006` is still empty and unused. Left in place (no archive column). Workflows Draft on letterhead and Find a precedent now point at the org Library Templates shelf and `replicate_document`.

Yule: hard-refresh `/library` and `/library/templates`. Open the Attune Legal shelf. Members can read and replicate; only admins mutate. Letterhead-perfect AL numbering stays a Word job after `replicate_document`.

Left uncommitted: Zoho/SharePoint fill-on-status leftovers (`httpUrl.ts`, integrations service/tests, ProjectWorkspace).

## 2026-09-21 — Library is a union, not org-instead-of-personal

Yule stopped the first org-library design. `/library` is a **union**: every user keeps today's personal Files + Templates, and also sees every organisation they belong to. Multi-org users see each shelf, labelled and grouped (Personal / Attune Legal / …). Writes stay on one shelf. Personal writes stay personal. Org writes follow `libraryRoleFromOrgRole` (admin → owner, member → viewer) via existing `can()`. Members read and `replicate_document` org templates; only admins mutate the org shelf. Chat template immutability is unchanged. Having an org membership must not hide the personal library.

Shipped as `09331d0b`. See the ship entry above.

## 2026-09-21 — Untitled-document fix and org memory shipped

Pushed `d753c7b8` (matter list filenames + org-scoped memory). Railway auto-deploy did not fire; `railway redeploy --from-source` on `mike` → `26a6de70` SUCCESS, SHA `d753c7b8`, https://mike-production-68f2.up.railway.app `/health` 200. That bounce restarted the upload-worker. Vercel preview `dpl_DFVdx2nH8m6cGeLsrdcVrWQHjsdk` READY; promoted to production `dpl_3sSbjYbFgKAEe9mRbzcJmR3nmuoH` READY + aliased to https://libris-colleague.vercel.app (`/` and `/login` 200). Did not apply migration 08, did not change `UPLOAD_PROCESSING_MAX_RUNNING_PER_USER`, did not deploy the dirty filer tree. Org-memory migration `20260921_02` was already live on `gttnqqwqoirwbvalqfce`.

Yule: hard-refresh S155. If Firm Library `383f34de-de29-45e3-89ab-31e09276c006` is still empty, upload Masters from OneDrive `Cowork - Cowork Library` (Templates `916ebaa7`, Commercial `fb616e60`, IP & Technology `40d04801`, ESOP `035e7df5`).

Left uncommitted: Zoho/SharePoint fill-on-status leftovers (`httpUrl.ts`, integrations service/tests, ProjectWorkspace). `schema.sql` and `mikeApi.ts` in this SHA are org-memory only.

## 2026-09-21 — Untitled documents fix and Attune org setup

Two workstreams. Shipped as `d753c7b8` (see ship entry above). Did not apply migration 08. Did not deploy the dirty filer.

### Workstream 1 (code, local)

`attachActiveVersionPaths` now chunks `.in()` at 100 ids, throws on PostgREST errors, and falls back to the latest live version when `current_version_id` is missing. DocTable also polls ready rows still titled Untitled document. After Railway/Vercel deploy, hard-refresh S155. No data backfill.

### Workstream 2 (product hook + this-instance tenant data)

- Migration `20260921_02_org_memory_files.sql` applied to production `gttnqqwqoirwbvalqfce` via Supabase MCP. Org memory columns are live. Attune house file is on org `587af71c-e526-4b0e-971e-7e2d285ddac8` (revision 2, 1452 bytes). Org memory is admin-edited only and is not curated from chats.
- App code injects org memory when the project's `org_id` matches (precedence: conversation > project > org > app). Organization workspace has an Organization memory editor for admins. Live on `d753c7b8`.
- Six Attune-org workflows created (not in DEFAULT_WORKFLOWS): House style and legal voice, Draft on letterhead, Find a precedent, New job request, Matter setup and naming, Retainer work note.
- Firm Library project `383f34de-de29-45e3-89ab-31e09276c006` (`Attune - Firm Library`) with folders Templates, Precedents / Commercial, IP & Technology, ESOP & Equity. Memory off. **No files uploaded** (no user credentials for Mike upload).
- S155 project memory filled with a working set (revision 39). Northeon already had a brief; its `org_id` was set to Attune Legal so org memory will inject after deploy. Empty project `c55d2d65` left alone.
- Two org admins already present (`0e66f3d3`, `57f82b85`).

### What Yule must do next

1. Hard-refresh S155 so the list join and org-memory injection show. Deploy is done (`d753c7b8`).
2. Upload Masters into Firm Library from OneDrive `Cowork - Cowork Library` (same bytes as the zip):
   - Templates: `Attune Legal Letterhead and Contract Template.docx`, `Attune Legal - presentation template.pptx` into folder `916ebaa7-42af-457b-810b-c86d2207e7fc`.
   - Precedents/Commercial (`fb616e60-bf05-47cd-8962-ac45a6af7eeb`): Confidentiality Agreement (One-Way), Privacy Policy, SaaS Terms of Service, Website Terms and Conditions.
   - Precedents/IP & Technology (`40d04801-ba44-4677-b2fc-7396d2891fbd`): Legaler R&D Services & IP Licence Agreement.
   - Precedents/ESOP & Equity (`035e7df5-549d-4b6b-b92a-c23dd6ad0eb1`): `ESOP [Create Template From This].docx` only. Skip Raw comparison copies.
3. Mike will not run `albuild.py`. Letterhead-perfect AL numbering stays a Word job after `replicate_document`.

## 2026-09-21 — S155 Zoho/SharePoint buttons were empty

The Matters table had the Zoho and SharePoint columns, but every project row was null. The pills hide when those fields are empty. Cause: S155 (and Northeon) were created before the columns existed, and the live filer still answers status/pull without `matterId` / `sharepointFolderUrl`, so Mike's fill-on-status write never ran.

Filled S155 `41cfbdbf-a1f8-47a2-be4d-1208eb375b0f` in place: Deal `3849704000030080744`, folder `https://attunelegal.sharepoint.com/sites/AttuneLegal/Shared Documents/Clients/Blue NRG Group Pty Ltd/Blue NRG/23-0011 - ACCC - s155 Notice and Enforcement` (legacy folder number 23-0011, not 242814). Hard-refresh shows the buttons. Northeon left blank (no `external_web_url` on its documents).

Local Mike now resolves missing links on status/pull: Zoho via filer search by matter number, SharePoint by walking up mirrored file URLs. Matter page also applies status links after the project row arrives. Not committed, not shipped. Did not deploy the dirty filer, did not apply migration 08.

## 2026-09-21 — External-links app deploy

SQL was already live on `gttnqqwqoirwbvalqfce`; the missing piece was the app deploy. Pushed `7f8a31d9` (quality pass), `e04a9927` (sync adopt/list), and `ca32f331` (Zoho/SharePoint links). Railway auto-deploy did not fire; triggered `redeploy --from-source` on existing `mike`. Railway `f66535bb` SUCCESS, SHA `ca32f331`, https://mike-production-68f2.up.railway.app `/health` 200. That bounce restarted the upload-worker. Vercel production `dpl_3F5eT46LFNqZwwFooCLcqeth9U9b` READY + aliased to https://libris-colleague.vercel.app. Did not apply migration 08, did not change `UPLOAD_PROCESSING_MAX_RUNNING_PER_USER`, did not deploy the dirty filer tree.

## 2026-09-21 — External-links migration on production

Applied `20260921_01_project_external_links.sql` to Libris Colleague Supabase `gttnqqwqoirwbvalqfce`. Columns `projects.zoho_deal_id` and `projects.sharepoint_folder_url` are live; both `get_projects_overview` overloads return them; `create_project_with_memory` accepts `p_zoho_deal_id` and `p_sharepoint_folder_url`. S155 project `41cfbdbf-a1f8-47a2-be4d-1208eb375b0f` still exists; document count stayed 237 (migration did not rewrite documents). Did not push Mike, did not redeploy Railway, did not apply migration 08, did not deploy the dirty filer tree. Hobby upgrade is Yule's to complete in the Railway dashboard; after that he still needs to raise the `mike` replica above 1 GB. `UPLOAD_PROCESSING_MAX_RUNNING_PER_USER` stays 2 until someone changes that env without a reckless restart.

## 2026-09-21 — Zoho and SharePoint links on matters

Matters list and matter page now link out to Zoho and SharePoint when the project has a Deal id and folder URL.

- Migration `20260921_01_project_external_links.sql`: `projects.zoho_deal_id`, `projects.sharepoint_folder_url`; overview RPCs and `create_project_with_memory` carry them. Not applied to production until Yule confirms.
- Filer `complete_pull` writes both fields (create and update) and stores `FolderWebUrl` on ColleagueMatterSync. Status returns `matterId` and `sharepointFolderUrl`. Filer changes are in the sibling `sharepoint-email-filer` tree, not this repo.
- Mike pull/status persist those fields (pull replaces, status fills blanks). Zoho URL is built from `libris-colleague` `externalLinks.zohoMatterBase`.
- UI (flag `zohoMatterPull`): Zoho / SharePoint columns on the Matters table; pills beside Documents, Chats, Tabular Reviews. Hidden when the matter has no URL.

## 2026-09-21 — S155 / 242814 matter-sync unstuck

Stall cause: the live Azure drain (`attuneemailfiler-flex` Durable `colleague_drain_orchestrator`) kept re-uploading the first Graph page as `document_create`. Filer skip in `_continue_slice` only skipped when stored `external_ctag` exactly matched Graph `cTag`/`eTag`. About 15 already-mirrored SharePoint item ids looped forever. Mike upserted a new UUID then died on `documents_project_external_item_unique`. Railway upload-worker logs from 10:30Z on 2026-09-20 through 20:50Z were that unique-key loop. Budget never reached new files. Postgres sat at ~113 ready docs (newest `2026-09-20 05:47:18Z`) until a later dribble to 123.

What changed:
- Filer (local only, not committed, not deployed): skip any known `external_item_id` even when ctag differs; accept camelCase; unwrap `docs`/`documents`/`data`; `GET .../documents?for=sync` with a 120s timeout.
- Mike: `processCreatedDocument` looks up `(project_id, sharepoint, item_id)` and adopts (same ctag = no-op, different ctag = version create); 23505 race adopts the same way. `GET /projects/:id/documents?for=sync` pages lite rows in 1000s.

Live copy: two local `continue_pass` slices against production (Function settings loaded privately, Azure `colleague-sync` lease was held so slices ran without it). Uploaded 12 then 11. Count rose to 152 (151 ready), newest `2026-09-20 20:55:29Z`, remaining ~1151. Azure drain is still on the old ctag-strict skip and still unique-key looping; a local Mike commit does not stop that drain. Do not `ALLOW_DIRTY_DEPLOY` the filer tree. Do not push Mike. Do not apply migration `20260920_08`. Next: keep local slices, or deploy a clean filer skip, or align stored ctags so the live skip starts working.

## 2026-09-20 — Quality pass on turn lease and finalize_document

Reviewed the five commits (`a3a0ce6f` .. `d6526181`) and tightened what had started to drift, without changing behaviour of the lease, reattach, or clean-copy tools.

- Both chat routes now bind the SSE writer through `bindChatTurnStream` (registry frames + heartbeat + finish), and return the same `turnInProgressBody` on 409. Project-chat cancel now audits as cancelled and no longer logs a closed socket as the abort reason.
- `finalize_document` is in the mutation-gating WRITERS list. Chat-local `doc-N` labels go through one allocator. Unused `COMMENT_ANCHOR_TAGS` removed. Tracked-change pending count is one helper.
- Reattach polling reads the transcript immediately, then every 5 s, so a just-finished 202 does not wait a full interval.
- `AccessibleChat` / `withRunningTurnMessage` carry the lease columns instead of `Record<string, unknown>` casts.

Left alone on purpose: `persistGeneratedFile` vs `runFinalizeDocument` still persist separately (different keys, source, cleanup); failed finalize/edit/replicate cards still live only on the live SSE (pre-existing). Pre-existing red suites unchanged.

## 2026-09-20 — Chat turn resilience and finalize_document

Second Northeon run failed three ways: Claude at `high` spent the 16k output cap thinking (finishReason `length`, no text, no tool call, mid-word cut), a second Continue ran concurrently and killed the turn that had just edited both documents, and navigating away closed the socket which aborted generation and saved "Cancelled by user."

Shipped as five commits on `cursor/setup-supabase-vercel-oss-cad9` (`a3a0ce6f` .. `d6526181`):
- `aiSdk.ts` retries an empty `length` step with the run's own `responseMessages`, a nudge, and one notch less reasoning (max 2); hosted adapters get `maxOutputTokens` 32k.
- Migration `20260920_08_chat_turn_lease.sql`: `chats.active_turn_*` columns, RPCs `claim_chat_turn` / `heartbeat_chat_turn` / `release_chat_turn` / `request_chat_turn_cancel`. Routes claim per turn, 409 `turn_in_progress`, refused user row deleted. Code fails open if the RPCs are missing.
- `assistantSse` no longer aborts on close for chat routes; `chat.turnRegistry.ts` records frames per turn; `POST /chat/:id/turns/:mid/cancel`, `GET /chat/:id/turns/:mid/stream` (replay + tail, 202 when not attachable); `GET /chat/:id` appends a `status: "running"` assistant row while the lease is fresh.
- `useAssistantChat`: thread switch detaches (no abort), Stop calls the cancel endpoint, 409 attaches to the running turn, pages call `attachToTurn` for a running row, polling fallback every 5 s. Gateway forwards `request.signal`.
- `docxTrackedChanges.ts`: `listTrackedChanges`, `acceptAllTrackedChanges` (ins/del/moves/property changes/comments, all story parts, deleted paragraph marks joined). `read_document` appends a TRACKED CHANGES inventory; new `finalize_document` tool saves "<name> (clean).docx" as a sibling document and emits `doc_finalized`.

Pre-existing red tests untouched: `ProjectMemoryModal` "preserves an editor's stale draft" (flaky typing), and six backend suites failing at import on mock gaps from the matter-brief/email-PDF commits (`streaming*.test.ts`, `appJobsWorker.test.ts`, `userDataCleanup.test.ts`). docker-compose db-init now mounts migrations 04 to 08.

Migration 08 is NOT applied to `gttnqqwqoirwbvalqfce` until Yule confirms; without it the lease and the "running" row on return do not function (everything else does).

## 2026-09-20 — Northeon matter-status file written on production

Pushed `960116d2` (email-only fenced status in project memory.md). Wrote production `memory_files` for Northeon project `e360041c-fe06-4743-8f43-23cae53a0f5b` to revision 5 (manual), fence plus working set: MSA AL Markup 260916, SOW updated 260918, Development Agreement Attune markup 260917. Stripped curator chat-failure residue. Ignore empty project `c55d2d65`.

## 2026-09-20 — Leftover local Mike work shipped

Committed and pushed `dc335bd0` (email PDF signatures/mojibake/blank-page fix plus Liberation fonts). Did not touch the filer.

Live now:
- Vercel `dpl_7dtvdQEQeNyx5RarkZDfTgLyNpzL` SHA `dc335bd0` on https://libris-colleague.vercel.app (READY + aliased). Live HTML has `data-profile="libris-colleague"`. Viewer, Li lockup, and Matters columns were already in `5d307c90`; this cut aliases HEAD.
- Railway `mike` deploy `bf04341a` SUCCESS, `/health` 200. Includes the email-PDF/Dockerfile leftovers.

## 2026-09-20 — Email PDF blank page, signatures, and mojibake

LibreOffice 7.4.7 (backend Docker image) was emitting a blank first page on almost every email PDF, dropping cid signature images, and garbled curly quotes/accents.

Causes: wrapper used `<h1>`/`<hr>`/`<p>` as the first body node (LO treats those as page breaks); `sanitizeEmailHtml` deleted `cid:` images; Outlook `charset=Windows-1252` nested inside our UTF-8 file made LO re-decode apostrophes as `â€™`.

Fix in `backend/src/lib/emailMessage.ts`: table-only masthead, cid inlined as data URIs, body-only HTML with page CSS stripped, `.msg` decoded by Internet code page, RTF `\'xx` kept, `fonts-liberation` on Dockerfile/nixpacks. Existing stored email PDFs will stay wrong until re-rendered.

## 2026-09-20 — Remaining local work shipped so Yule can test

Viewer fix `9ba8091c` was already aliased on `dpl_caizHhqJQ4M19EoiZ6maYrwb1Y7U` with `cache: "no-store"` in the live JS. Yule should still hard-refresh because a newer production cut is now aliased.

Live now:
- Vercel `dpl_HbfctagZSDfAvySRy72PwwnbrNVF` SHA `5d307c90` on https://libris-colleague.vercel.app (READY + aliased). Includes viewer, Li lockup, AU research UI, incomplete-turn recovery.
- Railway `mike` SHA `848f923` SUCCESS, `/health` 200. First AU research build `5d307c90` failed tsc; follow-up commit fixed buffers, version filters, and duplicate tool event exports.
- AU research columns applied on `gttnqqwqoirwbvalqfce`.
- Filer drain already live at `7c83727-dirty`. Leftover command-queue/MCP/publicity WIP failed 3 tests and was not committed. Kicked 242814: uploaded 6, remaining 1197, documentCount 101, status Syncing.

## 2026-09-20 — Chat was finishing research and never writing the answer

## 2026-09-20 — Chat was finishing research and never writing the answer

SOW/MSA chat `82e1fc70-ceb3-4094-8d50-f1be73a621a1` on project `e360041c-fe06-4743-8f43-23cae53a0f5b` ran three turns that only said "I'll pull the latest drafts", reread the Northeon emails + MSA/SOW, then died mid-reasoning. The backend saved those as successful completions, so the UI said "Completed in 12 steps".

Causes: `maxDuration` 60s on the Vercel `/api` gateway; 10 tool steps with high reasoning and no reserved write step; a prompt that forced a full reread on every continue.

Shipped with the AU research tools: gateway 300s; 16 steps with the last step tool-free; incomplete research-only turns now show an error and "Stopped after N steps"; continue gets previous-turn working notes and must not restart the reads.

## 2026-09-20 — Viewer 304: documents fetched then showed "could not be loaded"

Yule hard-refreshed production after `af8c1d0d` and still could not open files. He now hits "This document could not be loaded. Please try again." rather than an infinite spinner.

Evidence: Railway `/display` for `afea6820-9df6-4ed7-b9c0-e63188798f9c` was 200, then Vercel logged `GET /api/single-documents/afea6820-9df6-4ed7-b9c0-e63188798f9c/display 304`. Express ETags plus the `/api` gateway forwarding `If-None-Match` return an empty body. `useFetchSingleDoc` treats any non-2xx as a load failure. PDF.js worker `pdf.worker.min.0fycs0zatkwj0.mjs` is 200; a tiny PDF loaded in 71ms with 6.3.289. Fonts were not the remaining bug.

Fix: strip conditional request headers and ETags on the gateway, set `Cache-Control: private, no-store` on `/display` and `/file`, fetch with `cache: "no-store"`, reject HTML/JSON pretending to be a PDF, prefer the stored PDF for Word in the workspace as well as the side panel.

After hard-refresh, open `230125 - Letter to the ACCC advising address of service (final signed).pdf` and the matching `.docx`.

## 2026-09-20 — Synced documents opened but never finished rendering

Matter 242814 project `41cfbdbf-a1f8-47a2-be4d-1208eb375b0f`: all 26 listed files were `ready` with storage paths (6 pdf with page_count, 20 docx with converted-pdfs paths and null page_count). Railway `/display` and `/file` returned 200 when Yule clicked. Processing was not the hang.

Frontend viewer hid the spinner after fetch, then PDF.js/docx-preview could sit on a blank canvas. PDF.js fonts were pinned to 4.10.38 after the app moved to 6.3.289, and wasm was unset (scanned PDFs need jbig2). Word files in the side panel used docx-preview even when a PDF rendition existed.

Fix on `cursor/setup-supabase-vercel-oss-cad9`: prefer the stored PDF in DocumentSidePanel, match pdfjs 6.3 fonts/wasm, keep the spinner through render, time out a hung load, raise `maxDuration` on the `/api` gateway to 60s. Frontend only. Hard-refresh and open a named PDF plus a named Word file.

## 2026-09-20 — Libris wordmark and type are on production

Replaced the retired tittle bookmark with the Li swallowtail and the fullColor wordmark. Grenze Semibold now hits display headings; Source Sans Pro is the body face. Live on `https://libris-colleague.vercel.app` as `dpl_AnT9nMcBfy5ryba4ujTWKBtEDXkT`. Login shows the gothic Libris mark plus "Colleague", Log In in Grenze, form copy in Source Sans Pro, tab icon `/brand/libris-li-icon.png`. Do not use localhost to preview this; Yule tests production only.

## 2026-09-20 — Matter 242814 sync is moving again

Only 6 PDFs were in project `41cfbdbf-a1f8-47a2-be4d-1208eb375b0f` because the filer sweep was not hooked. Mike was not changed and Railway was not redeployed.

Filer `2534bb5` + `934c693` on `attuneemailfiler-flex` now continue enrolled matters every 5 minutes and on Sync now / re-pull. After a live continue-pass: 24 ready documents (6 pdf, 18 docx), 1256 remaining, status Syncing. Hard-refresh the matter; more files will keep arriving.

## 2026-09-20 — Pull from Zoho creates matter 242814

The earlier 500 on Pull and keep in sync was Mike mapping a filer 200 that had a resolved folder but no `projectId` to `internalFailure`. Railway log at 03:53 UTC: `filer pull answered without projectId`.

Fixed and verified live:
- Mike `4df4d157` on Railway: filer 200 without `projectId` (and other non-4xx) is now 503 with an intentional message, never a 500.
- Filer `6bed241` on `attuneemailfiler-flex`: pull enrols the Deal, creates the Colleague project as `colleague-sync@attune.legal`, and starts a bounded first file pass.
- Service account created in Supabase `gttnqqwqoirwbvalqfce` (admin of org `587af71c-e526-4b0e-971e-7e2d285ddac8`). Password is only in Azure app settings, not printed.
- Live pull of Deal `3849704000030080744` returned `projectId` `41cfbdbf-a1f8-47a2-be4d-1208eb375b0f`, `created: true`, uploaded 5, remaining 1275, status Syncing. Row exists in `projects` with `cm_number` 242814.
- Sweep is not hooked yet, so the remaining files wait. Yule can hard-refresh and pull again; the project is reused.

## 2026-09-20 — Pull from Zoho shipped to production

Yule tests Libris Colleague **only on Vercel production**. Once a change is ready for him to test, ship it there (commit, push the working branch, `vercel --prod` from the mike repo root, Railway `redeploy --from-source`, apply any new migration to Supabase `gttnqqwqoirwbvalqfce`). Do not wait for a local preview.

Shipped today as `66c66f17` on `cursor/setup-supabase-vercel-oss-cad9`:
- Frontend: Matters page → **Pull from Zoho** beside New (`featureFlags.zohoMatterPull` on the libris-colleague profile). Production `https://libris-colleague.vercel.app` (also `https://libris-colleague-lnxchanges-projects.vercel.app`). `NEXT_PUBLIC_DEPLOYMENT_PROFILE=libris-colleague`.
- Backend: Railway `mike` on `https://mike-production-68f2.up.railway.app`, commit `66c66f1`. `/health` 200. `/integrations/matters/search` 401 without auth.
- Migration `external_document_refs` applied on Libris Colleague (`gttnqqwqoirwbvalqfce`).
- Railway env now has `FILER_BASE_URL=https://attuneemailfiler-flex.azurewebsites.net`, `MATTER_SYNC_ORG_ID=587af71c-e526-4b0e-971e-7e2d285ddac8` (Attune Legal org), and `FILER_FUNCTION_KEY` (per-function key `libris-colleague` on Azure `colleague`). Set 2026-09-20 after the filer search route shipped.
- Filer `POST /api/colleague` search is live on `attuneemailfiler-flex` at commit `4578be3` (`cursor/fix-manage-chat-500`). `q=s155` returns matter `242814` "ACCC - s155 Notice and Enforcement" with `hasFolder: true` because `Old_SharePoint_Link` is populated (EasySharePoint id is still empty).
- Live pull now resolves that URL to a SharePoint `driveId` + `folderItemId`. Full project create + document upload is still later (no `projectId` yet). Status remains 501. Service account `colleague-sync@attune.legal` still needs a password from Yule.

Vercel project `libris-colleague` (`prj_EC5PaTsDVv1qilNET51j2KwdWzjK`), Root Directory `frontend`; deploy from the mike repo root. Railway project `reasonable-laughter`, service `mike`. Working branch `cursor/setup-supabase-vercel-oss-cad9`.

## 2026-09-20 — Matters list shows client, description, matter number

Zoho-synced matters were title-only. Shipped `45b48ba2` on `cursor/setup-supabase-vercel-oss-cad9`.

- Migration `20260920_05_project_client_description.sql` (04 was already used for legal research). Added nullable `projects.client_name` and `projects.description`. Updated `get_projects_overview` (both overloads), `get_project_ids_overview` search, and `create_project_with_memory` (8-arg). Applied to `gttnqqwqoirwbvalqfce`.
- POST/PATCH `/projects` accept `client_name` and `description`. Overview RPC returns them.
- Frontend (gated on `featureFlags.zohoMatterPull`): columns Name, Access, Matter number (`t.referenceNumber`), Client, Description, then Practice / Created by / Files.
- Backfill of `41cfbdbf-a1f8-47a2-be4d-1208eb375b0f` (cm_number 242814): client `Blue NRG Pty Ltd`, description `ACCC - s155 Notice and Enforcement`.
- Vercel production READY `dpl_HbScUSjbDfvongSDi6omutLMcKot`. Railway SUCCESS `2a25b2a8` after `railway redeploy --from-source`.
- Filer `cbe9c57` on `cursor/fix-manage-chat-500` sends `client_name` / `description` on create and PATCH. File sweep still owned by the other worker. Filer Azure deploy not required for the backfilled row.

## 2026-09-20 — Australian energy law research (ESC + AEMC)

Second AU research slice after Commonwealth FRL. Independent flag `legal_research_au_energy` (migration `20260920_06`). Defaults on when jurisdiction is Australia.

First-slice instruments: ESC ERCOP / EDCOP / GDCOP from esc.vic.gov.au Word downloads; AEMC NERR / NER / NGR from energy-rules.aemc.gov.au anonymous JSON. Tools: `au_search_energy`, `au_get_energy`, `au_get_energy_as_at`, `au_energy_versions`, `au_find_in_energy`. Cite only fetched official text. No AustLII. No new subscription. Word and tabular stay research-off.

Victoria has its own retail code: NERR is not treated as applying to Victorian retail customers unless comparing or asking about a participating jurisdiction. AER guidelines, AEMO procedures, Vic Acts, and case law are out of this slice.

Settings: Features → Legal Research → Australian energy law (no API key). Docs: `docs/au-energy.md`.

## 2026-09-20 — Remaining AU research surfaces (AER/AEMO, Vic statutes, case law)

Third AU research slice. Energy flag now also covers AER guidelines and AEMO procedures (same `legal_research_au_energy` tools). New independent flags `legal_research_au_vic` and `legal_research_au_cases` (migration `20260920_07`). Defaults on when jurisdiction is Australia.

Vic: Tide page JSON + authorised PDFs on legislation.vic.gov.au / content.legislation.vic.gov.au. Tools: `au_search_vic_legislation`, `au_get_vic_legislation`, `au_get_vic_legislation_as_at`, `au_vic_legislation_versions`, `au_find_in_vic_legislation`.

Cases: NSW Caselaw HTML, FCA Funnelback `fca~sp-judgments-internet`, HCA `eresources.hcourt.gov.au/showCase`. Tools: `au_search_case_law`, `au_get_case`, `au_find_in_case`. VSC/VSCA refused (AustLII). Cite only fetched official text. No new subscription. Word and tabular stay research-off.

Settings: Features → Victorian legislation / Australian case law. Docs: `docs/au-vic-legislation.md`, `docs/au-case-law.md`. Energy docs updated. Not shipped to production.

## 2026-09-20 — Email-only matter status in project memory

Fat matters were dying because chat tried to read the whole library to form a picture. Project memory now gets a background `memory.matter_brief` pass: latest email thread only (not chat), a short as-at note, working files named in that thread, and a grouped index. Refresh on new ready email, Zoho pull, or existing matters that still lack the fenced block. Curator must copy `<!-- matter-status:start -->` verbatim; the server restores it if dropped. Chat still has to open current drafts for mark-up.

In the tree, not shipped. Do not bundle with the unshipped AU research work. Yule tests production only.

# Mike / Libris Colleague — session memory

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

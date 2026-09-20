# Mike / Libris Colleague — session memory

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

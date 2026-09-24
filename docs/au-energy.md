# Australian energy law

Mike can query official Victorian ESC energy instruments, the national
energy Laws and their adoption Acts, AEMC rule books, AER guidelines, and
AEMO procedures: title search, the current instrument, the text as it
stood on a date, and version history.

This is a separate surface from Commonwealth legislation on the Federal
Register and from Victorian statutes. Turn it on independently.

## Enable

There is no required API key. ESC landing pages, the AEMC energy-rules
JSON API, AER and AEMO file pages, and official host or adoption-Act PDFs
are fetched live and anonymously. Successful official PDFs are cached on
disk for 12 hours. When `EXA_API_KEY` is set, a blocked official download
may be retrieved through Exa Contents; citations still use the official
URL. Retrieved instruments (and user uploads after an access failure) are
kept in the background legislation repository so later turns only check
that the held copy remains current. Seed the ordinary retail instruments
once, then the weekly worker job only re-downloads a file when the
official version list has changed.

Users turn the tools on under **Settings > Features > Legal Research >
Australian energy law**. When the profile jurisdiction is Australia and the
user has not chosen, the tools default on.

Existing deployments must apply
`backend/migrations/20260920_06_user_profile_legal_research_au_energy.sql`.
Fresh databases created from `backend/schema.sql` already include the column.

Word chats and tabular reviews keep energy research off.

## What the assistant can do

- Search ESC instruments, national energy Laws, adoption Acts, AEMC rule
  books, AER guidelines, and AEMO procedures by name or instrument id.
- Read a clause, heading, defined term, or page of the current instrument.
  A known id such as `esc:ercop` can be read directly; search is only for
  unknown ids. One get with the phrase is enough.
- Read the same instrument as at a `yyyy-mm-dd` date.
- List official versions.

## Background shelf

Retrieved official text is stored in `legal_source_documents`. Seed the
ordinary energy-retail shelf locally after the table exists:

```bash
npm run seed:energy-shelf --prefix backend
```

The script reads `backend/.env`, prefers an organisation whose name
contains "Attune", and otherwise uses `LEGAL_SOURCE_ORG_ID` or the first
local organisation. It downloads each catalog file once (official URL,
then Exa Contents when `EXA_API_KEY` is set and the host blocks) and
upserts by instrument id. AEMC books with more than 500 TOC nodes are
skipped as impractical; the seed prints that note and continues.

Existing local databases need
`backend/migrations/20260921_07_legal_source_documents.sql` (or a fresh
`schema.sql`). Do not apply that migration to production unless that
target has been confirmed.

A weekly `legal.shelf.refresh` db job then walks held `energy` and
`vic_legislation` rows. It lists official versions only. If the current
label (or official file URL) matches the held copy, it updates
`last_checked_at`. If the official version differs, it fetches once and
replaces the stored text. If the version list fails, it keeps the held
copy and sets `currency_status` to `unconfirmed`. The worker runtime
enqueues the job when due (startup plus a daily due-check, at most one
live row, default interval seven days). Override with
`LEGAL_SHELF_REFRESH_INTERVAL_MS` and `LEGAL_SHELF_CHECK_INTERVAL_MS`.

To verify the job locally after a seed, confirm a `db_jobs` row with
kind `legal.shelf.refresh` is pending or recently done, and that
`last_checked_at` on the held rows moves after it runs.

Current instruments include:

- `esc:ercop` Energy Retail Code of Practice
- `esc:edcop` Electricity Distribution Code of Practice
- `esc:gdcop` Gas Distribution Code of Practice
- `esc:vdo` Victorian Default Offer
- `esc:cprg` Compliance and Performance Reporting Guideline
- `aemc:nerr` National Energy Retail Rules
- `aemc:ner` National Electricity Rules
- `aemc:ngr` National Gas Rules
- `sa:nerl` National Energy Retail Law (SA host Act)
- `sa:nel` National Electricity Law (SA host Act)
- `sa:ngl` National Gas Law (SA host Act)
- `nsw:nerl-adoption` National Energy Retail Law (Adoption) Act 2012 (NSW)
- `nsw:nel-adoption` National Electricity (New South Wales) Act 1997
- `nsw:ngl-adoption` National Gas (New South Wales) Act 2008
- `qld:nerl-adoption` National Energy Retail Law (Queensland) Act 2014
- `act:nerl-adoption` National Energy Retail Law (ACT) Act 2012
- `aer:retail-compliance` AER Retail Compliance Procedures and Guidelines
- `aer:hardship` AER Customer Hardship Policy Guideline
- `aer:better-bills` AER Better Bills Guideline
- `aer:retailer-authorisation` AER Retailer Authorisation Guideline
- `aer:rpig` AER Retail Pricing Information Guidelines
- `aer:dmo` AER Default Market Offer
- `aer:ring-fencing-ed` AER electricity distribution ring-fencing guideline
- `aer:cba` AER Cost Benefit Analysis guidelines
- `aer:exempt-selling` AER exempt selling guideline
- `aemo:b2b` AEMO B2B procedures
- `aemo:msats` AEMO MSATS procedures
- `aemo:metering` AEMO retail and metering procedures
- `aemo:psop` AEMO power system operating procedures

Live requests go only to `esc.vic.gov.au`, `energy-rules.aemc.gov.au`,
`aer.gov.au`, `aemo.com.au`, `legislation.sa.gov.au`,
`legislation.nsw.gov.au`, `legislation.qld.gov.au`, and
`legislation.act.gov.au`. Citations must use those official URLs.
AustLII is not used.

The National Energy Retail Law lives in the South Australian host Act
(`sa:nerl`). Use that for NERL sections. Use the adoption Acts for how the
Law applies in a participating jurisdiction. South Australian pages are
sometimes bot-protected; if a fetch fails, stop and ask the user to
upload the official compilation. The matching adoption Act can still be
tried when the question is about how the Law applies in a participating
jurisdiction.

The National Energy Retail Rules are a first-class instrument
(`aemc:nerr`). Fetch them for participating jurisdictions (New South
Wales, Queensland, South Australia, Tasmania, and the ACT) and for any
direct question about the NERR.

Victoria has its own retail code. For Victorian retail customers, use the
Energy Retail Code of Practice. Do not treat the NERR, AER retail
guidelines, or AEMO procedures as applying to Victorian retail customers
unless the question is a comparison or is about a participating
jurisdiction.

Victorian statutes and Australian case law are separate surfaces. See
`docs/au-vic-legislation.md` and `docs/au-case-law.md`.

## Troubleshooting

If a tool reports a rate limit, wait and retry. The assistant should stop
further energy calls for that turn and answer from text already fetched.

If the official site blocks the download (Cloudflare on South Australian
host Acts is the usual case), the server first tries Exa Contents when
`EXA_API_KEY` is set, then any held copy of that instrument. If both miss,
the assistant must stop calling that instrument, tell the user which
source failed, and ask them to upload the official compilation or the
relevant extract under a `legal-source:energy:<instrumentId>` ask-input.
It must not invent the text. Uploaded compilations are stored for later
turns.

South Australian pages are sometimes bot-protected. The matching adoption
Act can still be tried when the question is about how the Law applies in
NSW, Queensland, or the ACT. Cite the official URL, not Exa.

If an instrument id is rejected, search again rather than constructing an
id. Ids look like `esc:ercop`, `aemc:nerr`, `sa:nerl`, `aer:hardship`, or
`aemo:msats`.

## Exa MCP (optional)

Colleague already supports user MCP connectors. Exa’s hosted server is
`https://mcp.exa.ai/mcp`. Add it from Settings → Connectors using the Exa
preset. For production limits, put the Attune Exa API key in the
connector’s custom headers as `x-api-key`, or complete Exa’s OAuth prompt.

The Exa MCP connector can still help find an official page. Server-side
Exa Contents (`EXA_API_KEY`) is the path that pulls official text when a
host blocks Mike. In both cases cite the official URL, not Exa. When both
the official host and Exa fail and no held copy exists, upload the
instrument into the chat.

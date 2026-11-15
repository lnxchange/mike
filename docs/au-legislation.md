# Australian Commonwealth legislation

Mike can query the Federal Register of Legislation for Commonwealth Acts and
legislative instruments: title search, the current compilation, the text as it
stood on a date, and compilation history.

## Enable

There is no API key. The Register API is free and unauthenticated.

Users turn the tools on under **Settings > Features > Legal Research >
Australian legislation (Commonwealth)**. When the profile jurisdiction is
Australia and the user has not chosen, the tools default on.

Existing deployments must apply
`backend/migrations/20260920_04_user_profile_legal_research_au.sql`. Fresh
databases created from `backend/schema.sql` already include the column.

## What the assistant can do

- Search titles and Register IDs.
- Read a section or page of the current compilation.
- Read the same title as at a `yyyy-mm-dd` date.
- List compilations and amendment notes.

Live requests go only to `https://api.prod.legislation.gov.au/v1/`. Citations
must use official `legislation.gov.au` URLs. AustLII is not used.

## Troubleshooting

If a tool reports a rate limit, wait and retry. The assistant should stop
further Register calls for that turn and answer from text already fetched.

If a title id is rejected, search again rather than constructing an id. Title
ids look like `C2004A03348` (Acts) or `F2019L00196` (instruments).

Victorian energy codes, AEMC rule books, AER guidelines, and AEMO
procedures are a separate surface. See `docs/au-energy.md`. Victorian
statutes are `docs/au-vic-legislation.md`. Australian case law is
`docs/au-case-law.md`.

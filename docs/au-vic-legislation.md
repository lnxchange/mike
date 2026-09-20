# Australian Victorian legislation

Mike can query Victorian Acts and statutory rules on
legislation.vic.gov.au: title search, the current authorised compilation,
the text as it stood on a date, and version history.

This is a separate surface from Commonwealth legislation on the Federal
Register and from Victorian ESC energy codes.

## Enable

There is no API key. Tide page JSON and authorised PDFs are fetched live
and anonymously.

Users turn the tools on under **Settings > Features > Legal Research >
Victorian legislation**. When the profile jurisdiction is Australia and the
user has not chosen, the tools default on.

Existing deployments must apply
`backend/migrations/20260920_07_user_profile_legal_research_au_vic_cases.sql`.
Fresh databases created from `backend/schema.sql` already include the
column.

Word chats and tabular reviews keep Victorian research off.

## What the assistant can do

- Search Victorian titles by name or id.
- Read a section or page of the current authorised compilation.
- Read the same title as at a `yyyy-mm-dd` date.
- List official versions.

The catalog includes energy, safety, consumer, and procedure titles, plus
commonly used statutory rules such as the electric line clearance
regulations. Search also reads the in-force listing from Tide when a
title is not in the curated list. Other in-force titles can still be
opened when the Tide slug matches. Authorised PDFs are cached on disk
for 12 hours.

Live requests go only to `legislation.vic.gov.au` and
`content.legislation.vic.gov.au`. Citations must use those official URLs.
AustLII is not used.

Victorian energy codes of practice remain on the energy surface. See
`docs/au-energy.md`.

## Troubleshooting

If a tool reports a rate limit, wait and retry. The assistant should stop
further Victorian legislation calls for that turn and answer from text
already fetched.

If a title id is rejected, search again rather than constructing an id.
Ids look like `vic:electricity-industry-act-2000`.

# Australian case law

Mike can search and read official High Court, Federal Court, NSW Caselaw,
and recent Supreme Court of Victoria PDFs: citation or keyword search,
the judgment text, and in-judgment probes after a case has been fetched
this turn.

This is a separate surface from US case law on CourtListener.

## Enable

There is no API key. Official court pages are fetched live and
anonymously.

Users turn the tools on under **Settings > Features > Legal Research >
Australian case law**. When the profile jurisdiction is Australia and the
user has not chosen, the tools default on.

Existing deployments must apply
`backend/migrations/20260920_07_user_profile_legal_research_au_vic_cases.sql`.
Fresh databases created from `backend/schema.sql` already include the
column.

Word chats and tabular reviews keep Australian case-law research off.

## What the assistant can do

- Search NSW Caselaw HTML, Federal Court Funnelback
  (`fca~sp-judgments-internet`), High Court medium-neutral citations, and
  recent VSC/VSCA PDFs on `supremecourt.vic.gov.au`.
- Read a paragraph or page of the official judgment.
- Search within a judgment already fetched in this turn.

Live requests go only to `caselaw.nsw.gov.au`,
`search.judgments.fedcourt.gov.au` / `judgments.fedcourt.gov.au`,
`eresources.hcourt.gov.au`, and `supremecourt.vic.gov.au`. Citations must
use those official URLs. Official PDFs are cached on disk for 12 hours.
AustLII is not used.

The Supreme Court of Victoria publishes only some recent judgments on its
own site. If no official PDF is there, the assistant says so rather than
using AustLII.

## Troubleshooting

If a tool reports a rate limit, wait and retry. The assistant should stop
further Australian case-law calls for that turn and answer from text
already fetched.

If a case id is rejected, search again rather than constructing an id.
Ids look like `nsw:<decision-id>`, `hca:2024:12`, or `fca:[2024]FCA1`.

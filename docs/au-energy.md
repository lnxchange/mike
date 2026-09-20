# Australian energy law

Mike can query official Victorian ESC energy instruments, the national
energy Laws and their adoption Acts, AEMC rule books, AER guidelines, and
AEMO procedures: title search, the current instrument, the text as it
stood on a date, and version history.

This is a separate surface from Commonwealth legislation on the Federal
Register and from Victorian statutes. Turn it on independently.

## Enable

There is no API key. ESC landing pages, the AEMC energy-rules JSON API,
AER and AEMO file pages, and official host or adoption-Act PDFs are
fetched live and anonymously. Successful official PDFs are cached on disk
for 12 hours.

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
- Read a clause or page of the current instrument.
- Read the same instrument as at a `yyyy-mm-dd` date.
- List official versions.

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
sometimes bot-protected; if a fetch fails, retry later or use the
matching adoption Act.

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

If an instrument id is rejected, search again rather than constructing an
id. Ids look like `esc:ercop`, `aemc:nerr`, `sa:nerl`, `aer:hardship`, or
`aemo:msats`.
